/**
 * Formatting of the open data: JSON, CSV and GeoJSON. Pure functions.
 *
 * The published contract (view names, column names, values) is French and unchanged from the
 * legacy API: other sites, embeds and spreadsheets depend on it. Everything around it is English.
 */

export const VIEWS = [
  'resume',
  'jours',
  'departements',
  'academies',
  'etablissements',
  'signalements',
] as const
export type View = (typeof VIEWS)[number]

export const FORMATS = ['json', 'csv', 'geojson'] as const
export type Format = (typeof FORMATS)[number]

export const LICENCE = 'CC BY 4.0'
export const ATTRIBUTION = 'Manifeste (manifeste.pandeo.fr)'
/** The data dictionary: every column and every value, in plain text. */
export const DOCUMENTATION = 'https://manifeste.pandeo.fr/dictionnaire-donnees.txt'

type Cell = string | number | boolean | null | undefined
export type Row = Record<string, Cell | Record<string, unknown> | unknown[]>

const ZONE_COLUMNS = (zone: string) => [
  zone,
  'etablissements',
  'lycees',
  'facs',
  'premier_jour',
  'dernier_jour',
  'signalements',
  'bloques_maintenant',
  'filtrants_maintenant',
  'mobilises',
]

/**
 * Column order of each view: the order a reader expects (day, name… before the counters).
 * Zone views name their first column "departement" or "academie" in the exports.
 */
const COLUMNS: Record<Exclude<View, 'resume'>, string[]> = {
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
    'mobilises',
    'mobilises_lycees',
    'mobilises_facs',
  ],
  departements: ZONE_COLUMNS('departement'),
  academies: ZONE_COLUMNS('academie'),
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
    'categorie',
    'signalements',
    'sites_sources',
    'origines',
    'confiance',
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
    'categorie',
    'origine',
    'site_source',
    'lien_source',
    'certitude',
    'confiance',
  ],
}

/** Puts the columns of a view in reading order and names the first column of zone views. */
export function shapeRows(view: View, rows: ReadonlyArray<Row>): Row[] {
  if (view === 'resume') return [...rows]
  const columns = COLUMNS[view]
  return rows.map((row) => {
    const source: Row = 'zone' in row ? { ...row, [columns[0] ?? 'zone']: row.zone } : row
    const out: Row = {}
    for (const c of columns) out[c] = source[c] ?? null
    return out
  })
}

export const isView = (v: string | null | undefined): v is View =>
  v != null && (VIEWS as readonly string[]).includes(v)

export const isFormat = (v: string | null | undefined): v is Format =>
  v != null && (FORMATS as readonly string[]).includes(v)

/** A CSV cell: doubled quotes when needed; never an executable spreadsheet formula. */
function cell(value: unknown): string {
  if (value == null) return ''
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Text starting with = + - @ would be read as a formula by Excel / LibreOffice.
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`
  return /[";\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** The summary is an object: flatten it into "key ; value" rows. */
export function flattenSummary(obj: Record<string, unknown>): Row[] {
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

/** CSV for French-locale Excel: ";" separator, UTF-8 with BOM, CRLF line endings. */
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
    documentation: DOCUMENTATION,
    features,
  })
}

export function filename(view: View, format: Format, now = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  return `manifeste-${view}-${day}.${format === 'geojson' ? 'geojson' : format}`
}
