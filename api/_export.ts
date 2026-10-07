// Mise en forme des données ouvertes : CSV, JSON, GeoJSON. Fonctions pures (testées).

export const VUES = [
  'resume',
  'jours',
  'departements',
  'academies',
  'etablissements',
  'signalements',
] as const
export type Vue = (typeof VUES)[number]

/**
 * Ordre des colonnes de chaque vue. La base renvoie du jsonb, qui range les clés par ordre
 * alphabétique : on remet ici un ordre de lecture (jour, nom... avant les compteurs).
 * Les vues par zone nomment la colonne « departement » ou « academie » dans les exports.
 */
const COLUMNS: Record<Exclude<Vue, 'resume'>, string[]> = {
  jours: [
    'jour',
    'etablissements',
    'bloques',
    'filtrants',
    'leves',
    'departements',
    'lycees',
    'facs',
    'signalements',
    'via_presse',
    'via_organisations',
    'via_autres_sources',
    'via_signalements_sur_place',
  ],
  departements: [
    'departement',
    'etablissements',
    'lycees',
    'facs',
    'premier_jour',
    'dernier_jour',
    'signalements',
    'bloques_maintenant',
    'filtrants_maintenant',
  ],
  academies: [
    'academie',
    'etablissements',
    'lycees',
    'facs',
    'premier_jour',
    'dernier_jour',
    'signalements',
    'bloques_maintenant',
    'filtrants_maintenant',
  ],
  etablissements: [
    'uai',
    'nom',
    'commune',
    'departement',
    'academie',
    'niveau',
    'lat',
    'lng',
    'premier_blocage',
    'dernier_signalement',
    'dernier_statut',
    'statut_direct',
    'signalements',
    'sites_sources',
    'origines',
  ],
  signalements: [
    'observe_le',
    'jour',
    'uai',
    'nom',
    'commune',
    'departement',
    'academie',
    'niveau',
    'statut',
    'origine',
    'site_source',
    'lien_source',
    'certitude',
  ],
}

/** Remet les colonnes dans l'ordre de lecture (et nomme la colonne des vues par zone). */
export function shapeRows(vue: Vue, rows: ReadonlyArray<Row>): Row[] {
  if (vue === 'resume') return [...rows]
  const columns = COLUMNS[vue]
  return rows.map((row) => {
    const source: Row = 'zone' in row ? { ...row, [columns[0] ?? 'zone']: row.zone } : row
    const out: Row = {}
    for (const c of columns) out[c] = source[c] ?? null
    return out
  })
}

export const FORMATS = ['json', 'csv', 'geojson'] as const
export type Format = (typeof FORMATS)[number]

export const LICENCE = 'CC BY 4.0'
export const ATTRIBUTION = 'Manifeste (manifeste.pandeo.fr)'

type Cell = string | number | boolean | null | undefined
export type Row = Record<string, Cell | Record<string, unknown> | unknown[]>

export function isVue(v: string | null): v is Vue {
  return v != null && (VUES as readonly string[]).includes(v)
}

export function isFormat(v: string | null): v is Format {
  return v != null && (FORMATS as readonly string[]).includes(v)
}

/** Une cellule CSV : guillemets doublés si besoin ; pas de formule exécutable dans un tableur. */
function cell(value: unknown): string {
  if (value == null) return ''
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Un texte qui commence par = + - @ serait lu comme une formule par Excel / LibreOffice.
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`
  return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** Le résumé est un objet : on l'aplatit en lignes « cle ; valeur ». */
export function flattenResume(obj: Record<string, unknown>): Row[] {
  const out: Row[] = []
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const label =
          item && typeof item === 'object' && 'origine' in item
            ? String((item as { origine: unknown }).origine)
            : String(i)
        walk(item, `${path}.${label}`)
      })
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'origine' && path.startsWith('origines')) continue
        walk(v, path ? `${path}.${k}` : k)
      }
    } else {
      out.push({ cle: path, valeur: value as Cell })
    }
  }
  walk(obj, '')
  return out
}

const BOM = String.fromCharCode(0xfeff)

/** CSV pour Excel en français : séparateur « ; », UTF-8 avec BOM, fins de ligne CRLF. */
export function toCsv(rows: ReadonlyArray<Row>): string {
  if (!rows[0]) return BOM
  const columns = Object.keys(rows[0])
  const lines = [columns.join(';')]
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(';'))
  return `${BOM}${lines.join('\r\n')}\r\n`
}

export function toGeoJson(rows: ReadonlyArray<Row>): string {
  const features = rows
    .filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number')
    .map((r) => {
      const { lat, lng, ...properties } = r
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties,
      }
    })
  return JSON.stringify({
    type: 'FeatureCollection',
    licence: LICENCE,
    attribution: ATTRIBUTION,
    features,
  })
}

export function filename(vue: Vue, format: Format, now = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  const ext = format === 'geojson' ? 'geojson' : format
  return `manifeste-${vue}-${day}.${ext}`
}
