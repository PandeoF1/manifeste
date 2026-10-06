/**
 * Import des établissements d'enseignement supérieur dans la même table que les lycées
 * (un seul mouvement, une seule carte). Idempotent : upsert sur l'UAI.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:higher-ed
 *   npm run import:higher-ed -- --dry-run
 *   npm run import:higher-ed -- --implantations impl.json --principals princ.json
 *
 * Jeux de données (data.enseignementsup-recherche.gouv.fr, API Explore v2.1) :
 * fr-esr-implantations_etablissements_d_enseignement_superieur_publics et
 * fr-esr-principaux-etablissements-enseignement-superieur.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.ts'
import {
  buildSites,
  implantationSchema,
  principalSchema,
  type Implantation,
  type Principal,
} from './higher-ed.ts'

const BASE = 'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets'
const IMPLANTATIONS = 'fr-esr-implantations_etablissements_d_enseignement_superieur_publics'
const PRINCIPALS = 'fr-esr-principaux-etablissements-enseignement-superieur'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function load(dataset: string, file: string | undefined): Promise<unknown[]> {
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as unknown[]
  console.log(`Téléchargement de ${dataset}…`)
  const res = await fetch(`${BASE}/${dataset}/exports/json`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Export HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as unknown[]
}

function parseAll<T>(
  raw: unknown[],
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  label: string,
): T[] {
  const out: T[] = []
  for (const [i, item] of raw.entries()) {
    const parsed = schema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
    else if (i === 0)
      throw new Error(`Schéma de « ${label} » modifié, adapter scripts/higher-ed.ts.`)
  }
  return out
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const implantations = parseAll<Implantation>(
    await load(IMPLANTATIONS, arg('implantations')),
    implantationSchema,
    IMPLANTATIONS,
  )
  const principals = parseAll<Principal>(
    await load(PRINCIPALS, arg('principals')),
    principalSchema,
    PRINCIPALS,
  )
  const sites = buildSites(implantations, principals)
  console.log(
    `${sites.length} sites (${implantations.length} implantations, ${principals.length} établissements principaux).`,
  )
  if (dryRun) {
    console.log('Exemples :', sites.slice(0, 5))
    return
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.')
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  const now = new Date().toISOString()
  const rows = sites.map((s) => ({
    uai: s.uai,
    name: s.name,
    city: s.city,
    postcode: s.postcode,
    department: s.department,
    academy: s.academy,
    location: `SRID=4326;POINT(${s.lng} ${s.lat})`,
    kind: 'supérieur',
    level: 'superieur' as const,
    updated_at: now,
  }))
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
