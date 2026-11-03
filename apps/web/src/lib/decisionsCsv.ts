/**
 * Reads the decisions of an exported moderation queue that was filled in a spreadsheet: the `id`
 * and `decision` columns. French Excel saves with ";" and people write "valider" or "oui", so
 * the separator and the words are forgiving. A blank decision means "not decided yet".
 */
export type Decision = 'approve' | 'reject'
export interface ParsedDecisions {
  decisions: Array<{ id: string; decision: Decision }>
  /** Lines with a decision word we could not read (line numbers, 1-based, header included). */
  unreadable: number[]
  /** Lines with no decision at all. */
  blank: number
  /** Set when the file has no usable header. */
  error: string | null
}

const APPROVE = new Set([
  'approve',
  'approved',
  'valider',
  'valide',
  'validé',
  'oui',
  'ok',
  'v',
  'o',
  'y',
  'yes',
])
const REJECT = new Set([
  'reject',
  'rejected',
  'rejeter',
  'rejete',
  'rejeté',
  'refuser',
  'non',
  'r',
  'n',
  'no',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Splits CSV text into rows of cells, honouring quotes (a quoted cell may hold the separator and newlines). */
export function parseCsv(text: string, separator: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === separator) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      out.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    out.push(row)
  }
  return out
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

export function parseDecisions(raw: string): ParsedDecisions {
  const text = raw.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows = parseCsv(text, separator)
  const result: ParsedDecisions = { decisions: [], unreadable: [], blank: 0, error: null }
  const header = (rows[0] ?? []).map(norm)
  const idCol = header.indexOf('id')
  const decisionCol = header.indexOf('decision')
  if (idCol < 0 || decisionCol < 0) {
    result.error = 'Colonnes « id » et « decision » introuvables : utilise le fichier exporté.'
    return result
  }
  for (const [i, row] of rows.slice(1).entries()) {
    const id = (row[idCol] ?? '').trim()
    const word = norm(row[decisionCol] ?? '')
    if (!id && !word) continue // empty line
    if (word === '') result.blank++
    else if (!UUID.test(id)) result.unreadable.push(i + 2)
    else if (APPROVE.has(word)) result.decisions.push({ id, decision: 'approve' })
    else if (REJECT.has(word)) result.decisions.push({ id, decision: 'reject' })
    else result.unreadable.push(i + 2)
  }
  return result
}
