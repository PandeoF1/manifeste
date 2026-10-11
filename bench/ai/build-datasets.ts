/**
 * One-off conversion of the hand-labelled audits into the golden dataset `datasets/ai/reports.jsonl`.
 * Kept in the repo to document where every label comes from; the output is what is committed.
 *
 *   bun ai/build-datasets.ts <audit-dir>
 *
 * <audit-dir> holds the manual audit of 200 validated reports (`audit-manuel.csv` with the
 * verdicts and `audit-manuel-echantillon.json` with the report data, both private) and the
 * judge sample (`datasets/source/compare-judge-sample-relu.csv`, in git).
 *
 * Each row is "one report the pipeline published": the article, the school and status it
 * claimed, and a human verdict on whether the article really says so.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) throw new Error('usage: bun ai/build-datasets.ts <audit-dir>')

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)
  const [header, ...body] = rows
  return (body ?? []).map((r) => Object.fromEntries((header ?? []).map((h, i) => [h, r[i] ?? ''])))
}

const STATUS = { bloque: 'blocked', filtrant: 'filtering', leve: 'lifted' } as const
const NATURE = {
  blocage: 'blockade',
  ferme: 'closed',
  rassemblement: 'gathering',
  incident: 'incident',
  autre: 'other',
} as const
const ERROR_TYPE = {
  incident: 'incident',
  manifestation_sans_blocage: 'demonstration-only',
  autre: 'other',
  mauvais_etablissement: 'wrong-school',
  recit_passe: 'past-story',
} as const
const LABEL = { oui: 'yes', non: 'no', incertain: 'unsure' } as const

const pageHash = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 10)

interface Sample {
  id: string
  status: keyof typeof STATUS
  observed_at: string
  source_domain: string
  school: { city: string; name: string; department: string }
}
const samples = new Map(
  (JSON.parse(readFileSync(join(dir, 'audit-manuel-echantillon.json'), 'utf8')) as Sample[]).map(
    (s) => [s.id, s],
  ),
)

interface Row {
  id: string
  url: string
  page: string
  school: { name: string; city: string; department: string | null }
  status: 'blocked' | 'filtering' | 'lifted'
  /** What the pipeline stored as the time of the fact. */
  observedAt: string | null
  label: 'yes' | 'no' | 'unsure'
  errorType: string | null
  /** The status a human read in the article, when it differs from the claimed one. */
  actualStatus: 'blocked' | 'filtering' | 'lifted' | 'none' | null
  quote: string
  /** Where the label comes from. */
  origin: 'manual-audit' | 'judge-sample'
  /** What Jev answered when the sample was built (frozen, for the offline baseline). */
  recordedJev?: { probability: number; nature: string }
}

const out = new Map<string, Row>()

for (const r of parseCsv(readFileSync(join(dir, 'audit-manuel.csv'), 'utf8'))) {
  const sample = samples.get(r.id ?? '')
  const label = LABEL[(r.blocage ?? '') as keyof typeof LABEL]
  if (!sample || !label || !r.url_finale) continue
  const real = r.statut_reel as keyof typeof STATUS | 'aucun' | ''
  out.set(r.id as string, {
    id: r.id as string,
    url: r.url_finale,
    page: pageHash(r.url_finale),
    school: {
      name: sample.school.name,
      city: sample.school.city,
      department: sample.school.department ?? null,
    },
    status: STATUS[sample.status],
    observedAt: sample.observed_at ?? null,
    label,
    errorType: ERROR_TYPE[(r.type_erreur ?? '') as keyof typeof ERROR_TYPE] ?? null,
    actualStatus: real === 'aucun' ? 'none' : real && real in STATUS ? STATUS[real] : null,
    quote: r.citation ?? '',
    origin: 'manual-audit',
  })
}

for (const r of parseCsv(
  readFileSync(
    join(import.meta.dirname, '../datasets/source/compare-judge-sample-relu.csv'),
    'utf8',
  ),
)) {
  const label = LABEL[(r.blocage ?? '') as keyof typeof LABEL]
  if (!label || label === 'unsure' || !r.url_finale || !r.id) continue
  const nature = NATURE[(r.nature_jev ?? '') as keyof typeof NATURE]
  const previous = out.get(r.id)
  const recordedJev =
    r.proba_jev && nature ? { probability: Number(r.proba_jev), nature } : undefined
  if (previous) {
    if (recordedJev) previous.recordedJev = recordedJev
    continue
  }
  out.set(r.id, {
    id: r.id,
    url: r.url_finale,
    page: pageHash(r.url_finale),
    school: { name: r.ecole ?? '', city: r.ville ?? '', department: null },
    status: STATUS[(r.statut_gemini ?? 'bloque') as keyof typeof STATUS],
    observedAt: null,
    label,
    errorType: ERROR_TYPE[(r.type_erreur ?? '') as keyof typeof ERROR_TYPE] ?? null,
    actualStatus: null,
    quote: r.citation ?? '',
    origin: 'judge-sample',
    ...(recordedJev && { recordedJev }),
  })
}

const rows = [...out.values()].sort((a, b) => a.id.localeCompare(b.id))
writeFileSync(
  join(import.meta.dirname, '../datasets/ai/reports.jsonl'),
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
)
const by = (f: (r: Row) => string) =>
  Object.entries(
    rows.reduce<Record<string, number>>((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {}),
  )
console.log(
  `${rows.length} reports`,
  by((r) => r.label),
  by((r) => r.origin),
)
