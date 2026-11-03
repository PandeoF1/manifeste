/**
 * Reads the filled export of the unmatched queue. In the `uai` column a person (or Claude) writes
 * the school's UAI, or 1 / 2 / 3 to take the candidate of that rank listed in the same row, or
 * "ecarter" to drop the fact. A blank cell leaves the fact waiting.
 */
import { parseCsv } from './decisionsCsv'

export type UnmatchedDecision = { id: string; uai: string } | { id: string; dismiss: true }
export interface ParsedUnmatched {
  decisions: UnmatchedDecision[]
  unreadable: number[]
  blank: number
  error: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UAI = /^[0-9]{7}[A-Z]$/
const DISMISS = new Set(['ecarter', 'ecarte', 'ignorer', 'jeter', 'rejeter', 'non', 'dismiss', 'x'])
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

export function parseUnmatched(raw: string): ParsedUnmatched {
  const text = raw.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows = parseCsv(text, sep)
  const header = (rows[0] ?? []).map(norm)
  const col = (name: string) => header.indexOf(name)
  const result: ParsedUnmatched = { decisions: [], unreadable: [], blank: 0, error: null }
  if (col('id') < 0 || col('uai') < 0) {
    result.error = 'Colonnes « id » et « uai » introuvables : utilise le fichier exporté.'
    return result
  }
  const cells = (row: string[], name: string) => (row[col(name)] ?? '').trim()
  for (const [i, row] of rows.slice(1).entries()) {
    const id = cells(row, 'id')
    const value = cells(row, 'uai')
    if (!id && !value) continue
    if (value === '') {
      result.blank++
      continue
    }
    const rank = /^c?([1-3])$/i.exec(value)?.[1]
    const uai = rank ? cells(row, `c${rank}_uai`) : value.toUpperCase()
    if (!UUID.test(id)) result.unreadable.push(i + 2)
    else if (DISMISS.has(norm(value))) result.decisions.push({ id, dismiss: true })
    else if (UAI.test(uai)) result.decisions.push({ id, uai })
    else result.unreadable.push(i + 2)
  }
  return result
}
