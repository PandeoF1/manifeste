/**
 * Import du référentiel des lycées depuis l'Annuaire de l'éducation (data.education.gouv.fr).
 * Idempotent : upsert sur l'UAI, relançable à volonté.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:schools
 *   npm run import:schools -- --dry-run            # télécharge et valide sans écrire
 *   npm run import:schools -- --file export.json   # utilise un export JSON déjà téléchargé
 *
 * Jeu de données : fr-en-annuaire-education (API Explore v2.1).
 * Le schéma est validé avec zod : si un champ change de nom, le script s'arrête avec un message clair.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '../src/lib/database.types.ts'
import { isExcludedEstablishment } from './school-filter.ts'

const DATASET = 'fr-en-annuaire-education'
const EXPORT_URL =
  `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/${DATASET}/exports/json?` +
  new URLSearchParams({
    where: 'type_etablissement="Lycée"',
    select: [
      'identifiant_de_l_etablissement',
      'nom_etablissement',
      'nom_commune',
      'code_postal',
      'code_departement',
      'libelle_academie',
      'latitude',
      'longitude',
      'voie_generale',
      'voie_technologique',
      'voie_professionnelle',
      'etat',
    ].join(','),
  }).toString()

const flag = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => v === 1 || v === '1' || v === 'Oui')

const recordSchema = z.object({
  identifiant_de_l_etablissement: z.string(),
  nom_etablissement: z.string(),
  nom_commune: z.string(),
  code_postal: z
    .union([z.string(), z.number()])
    .nullable()
    .transform((v) => (v == null ? null : String(v).padStart(5, '0'))),
  code_departement: z.string().nullable(),
  libelle_academie: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  voie_generale: flag,
  voie_technologique: flag,
  voie_professionnelle: flag,
  etat: z.string().nullable().optional(),
})
type SourceRecord = z.infer<typeof recordSchema>

function kindOf(
  r: Pick<SourceRecord, 'voie_generale' | 'voie_technologique' | 'voie_professionnelle'>,
): string {
  const gt = r.voie_generale || r.voie_technologique
  if (r.voie_professionnelle && gt) return 'polyvalent'
  if (r.voie_professionnelle) return 'pro'
  return 'général'
}

/** Code département sur 2 ou 3 caractères ("075" -> "75", "971" reste "971", "02A" -> "2A"). */
function normalizeDepartment(code: string | null): string | null {
  if (!code) return null
  const c = code.trim().toUpperCase()
  return c.length === 3 && c.startsWith('0') ? c.slice(1) : c
}

/** Fusion de deux lignes partageant le même UAI : on cumule les voies et on complète les trous. */
function mergeRecords(a: SourceRecord, b: SourceRecord): SourceRecord {
  const hasCoords = a.latitude != null && a.longitude != null
  return {
    ...a,
    code_postal: a.code_postal ?? b.code_postal,
    code_departement: a.code_departement ?? b.code_departement,
    libelle_academie: a.libelle_academie ?? b.libelle_academie,
    latitude: hasCoords ? a.latitude : b.latitude,
    longitude: hasCoords ? a.longitude : b.longitude,
    voie_generale: a.voie_generale || b.voie_generale,
    voie_technologique: a.voie_technologique || b.voie_technologique,
    voie_professionnelle: a.voie_professionnelle || b.voie_professionnelle,
  }
}

function toRow(r: SourceRecord, now: string): Database['public']['Tables']['schools']['Insert'] {
  return {
    uai: r.identifiant_de_l_etablissement,
    name: r.nom_etablissement.trim(),
    city: r.nom_commune.trim(),
    postcode: r.code_postal,
    department: normalizeDepartment(r.code_departement),
    academy: r.libelle_academie,
    location:
      r.latitude != null && r.longitude != null
        ? `SRID=4326;POINT(${r.longitude} ${r.latitude})`
        : null,
    kind: kindOf(r),
    updated_at: now,
  }
}

async function loadRecords(file: string | undefined): Promise<unknown[]> {
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as unknown[]
  console.log(`Téléchargement de ${DATASET}…`)
  const res = await fetch(EXPORT_URL, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Export HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as unknown[]
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const fileIdx = args.indexOf('--file')
  const file = fileIdx >= 0 ? args[fileIdx + 1] : undefined

  const raw = await loadRecords(file)
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Export vide ou inattendu.')

  const now = new Date().toISOString()
  // Le jeu de données expose parfois plusieurs lignes pour un même UAI (une par voie
  // d'enseignement) : il faut les fusionner, sinon un lot d'upsert touche deux fois la même
  // ligne et Postgres refuse ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  const byUai = new Map<string, SourceRecord>()
  let skipped = 0
  let merged = 0
  let excluded = 0
  for (const [i, item] of raw.entries()) {
    const parsed = recordSchema.safeParse(item)
    if (!parsed.success) {
      if (i === 0) {
        console.error('Le premier enregistrement ne correspond pas au schéma attendu :')
        console.error(JSON.stringify(item, null, 2).slice(0, 2000))
        console.error(parsed.error.issues)
        throw new Error('Schéma du jeu de données modifié, adapter scripts/import-schools.ts.')
      }
      skipped++
      continue
    }
    const r = parsed.data
    if (r.etat && r.etat.toUpperCase() !== 'OUVERT') {
      skipped++
      continue
    }
    if (isExcludedEstablishment(r.nom_etablissement)) {
      excluded++
      continue
    }
    const uai = r.identifiant_de_l_etablissement
    if (!/^[0-9]{7}[A-Z]$/.test(uai)) {
      skipped++
      continue
    }
    const previous = byUai.get(uai)
    if (previous) merged++
    byUai.set(uai, previous ? mergeRecords(previous, r) : r)
  }
  const rows = [...byUai.values()].map((r) => toRow(r, now))
  console.log(
    `${rows.length} lycées valides, ${excluded} sections et écoles exclues, ${skipped} ignorés, ${merged} doublons fusionnés.`,
  )
  if (dryRun) {
    console.log('Exemple :', rows.slice(0, 3))
    return
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.')
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from('schools')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'uai' })
    if (error) throw new Error(`Upsert lot ${i / BATCH + 1} : ${error.message}`)
    process.stdout.write(`\r${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }
  console.log('\nImport terminé.')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
