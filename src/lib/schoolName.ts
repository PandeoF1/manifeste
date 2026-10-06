// Mise en forme d'un nom de lycée saisi par un visiteur : « lycee agricole jean monnet »
// devient « Lycée agricole Jean-Monnet » (proposition, modifiable par l'équipe).

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

/** Nom propre (après le type) : « jean monnet » -> « Jean-Monnet », particules en minuscule. */
function properName(rest: string): string {
  const words = rest.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  // Plusieurs mots commençant par une majuscule = nom de personne relié par des tirets
  // (usage des noms d'établissements) ; les particules restent séparées.
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
