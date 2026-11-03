/**
 * CSV for staff exports. Cells come from the press and from visitors, and a spreadsheet runs a
 * cell that starts with = + - @ as a formula: those get a leading apostrophe.
 */
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(
  header: readonly string[],
  lines: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): string {
  // A BOM makes Excel read the accents as UTF-8.
  return `\uFEFF${[header, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`
}
