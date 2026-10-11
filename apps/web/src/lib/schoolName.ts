// Formatting of a school name typed by a visitor: "lycee agricole jean monnet"
// becomes "Lycée agricole Jean-Monnet" (a proposal, editable by the team).

const TYPES: Array<[RegExp, string]> = [
  [
    /^lyc[eé]e\s+(polyvalent|professionnel|general et technologique|général et technologique|agricole|maritime|technique|technologique|general|général|des métiers|des metiers)\b/i,
    '',
  ],
  [/^lyc[eé]e\b/i, ''],
  [/^lp\b/i, 'professionnel'],
  [/^lpo\b/i, 'polyvalent'],
  [/^lgt\b/i, 'général et technologique'],
  [/^lycee\b/i, ''],
]
const LOWER = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'et',
  'en',
  'sur',
  'sous',
  'aux',
  'au',
  "d'",
  "l'",
])
const ACCENTS: Record<string, string> = {
  general: 'général',
  metiers: 'métiers',
  lycee: 'lycée',
}

function cap(w: string): string {
  if (!w) return w
  const lower = w.toLowerCase()
  const fixed = ACCENTS[lower] ?? lower
  return fixed.charAt(0).toUpperCase() + fixed.slice(1)
}

/** Proper name (after the type): "jean monnet" -> "Jean-Monnet", particles in lowercase. */
function properName(rest: string): string {
  const words = rest.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  // Several capitalised words = a person's name joined by hyphens
  // (school naming practice); particles stay separate.
  const out = words.map((w) => {
    const lw = w.toLowerCase()
    if (LOWER.has(lw)) return lw
    if (/^(d|l)'/i.test(w)) return lw.slice(0, 2) + cap(w.slice(2))
    return w.split('-').map(cap).join('-')
  })
  const allNames = out.every((w) => !LOWER.has(w) && /^[A-ZÀ-Ý]/.test(w))
  return allNames && out.length <= 3 ? out.join('-') : out.join(' ')
}

export function formatSchoolName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return s
  let kind = ''
  for (const [re] of TYPES) {
    const m = s.match(re)
    if (m) {
      const t = m[0]
        .replace(/^lyc[eé]e\s*/i, '')
        .trim()
        .toLowerCase()
      kind = { lp: 'professionnel', lpo: 'polyvalent', lgt: 'général et technologique' }[t] ?? t
      s = s.slice(m[0].length).trim()
      break
    }
  }
  kind = kind
    .split(' ')
    .map((w) => ACCENTS[w] ?? w)
    .join(' ')
  const name = properName(s)
  return ['Lycée', kind, name].filter(Boolean).join(' ')
}
