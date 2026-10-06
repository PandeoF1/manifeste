/** Candidat renvoyé par la fonction SQL public.match_school. */
export interface SchoolCandidate {
  uai: string
  name: string
  city: string
  name_score: number
  city_score: number
  score: number
}

export const MATCH_THRESHOLDS = {
  minScore: 0.6,
  minNameScore: 0.6,
  minCityScore: 0.5,
  minMargin: 0.05,
  /** Sans ville connue, le nom doit être quasi exact. */
  minNameScoreWithoutCity: 0.9,
} as const

/**
 * Choisit un UAI seulement si le meilleur candidat est net :
 * score suffisant, ville cohérente quand elle est connue, et écart suffisant avec le second
 * (sinon homonyme probable, on préfère ne rien rattacher).
 */
export function pickMatch(
  candidates: ReadonlyArray<SchoolCandidate>,
  hasCity: boolean,
  t: typeof MATCH_THRESHOLDS = MATCH_THRESHOLDS,
): SchoolCandidate | null {
  const [best, second] = [...candidates].sort((a, b) => b.score - a.score)
  if (!best) return null
  if (hasCity) {
    if (best.name_score < t.minNameScore || best.city_score < t.minCityScore) return null
    if (best.score < t.minScore) return null
  } else if (best.name_score < t.minNameScoreWithoutCity) {
    return null
  }
  if (second && best.score - second.score < t.minMargin) return null
  return best
}

const GENERIC_WORDS = new Set([
  'lycee',
  'lycees',
  'lp',
  'lgt',
  'lpo',
  'general',
  'generale',
  'polyvalent',
  'professionnel',
  'technologique',
  'public',
  'prive',
  'universite',
  'universites',
  'fac',
  'faculte',
  'iut',
  'ufr',
  'campus',
  'site',
  'des',
  'du',
  'de',
  'la',
  'le',
  'les',
  'l',
  'd',
  'et',
  'a',
])

function normalizeWords(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Nom sans les mots génériques (miroir de public.strip_generic_words). */
export function stripGenericWords(name: string): string {
  return normalizeWords(name)
    .filter((w) => !GENERIC_WORDS.has(w))
    .join(' ')
}

/** Niveau d'un établissement d'après le nom cité (« Université de Nanterre », « fac de Tolbiac »). */
export function levelOfName(name: string): 'lycee' | 'superieur' {
  const words = normalizeWords(name)
  if (words.includes('lycee') || words.includes('lycees')) return 'lycee'
  const higher = ['universite', 'universites', 'fac', 'faculte', 'iut', 'ufr', 'campus', 'iep']
  if (words.some((w) => higher.includes(w))) return 'superieur'
  return words.join(' ').includes('sciences po') ? 'superieur' : 'lycee'
}

/**
 * Vrai si le nom ne désigne aucun établissement précis : « Lycée », « lycée de Hanches », « Université »
 * (miroir de public.is_generic_school_name).
 */
export function isGenericSchoolName(name: string, city: string | null): boolean {
  const stripped = stripGenericWords(name)
  return stripped === '' || stripped === stripGenericWords(city ?? '')
}

export interface NearbyCandidate {
  uai: string
  name: string
  distance_m: number
}

/**
 * Rattachement par position (point d'une carte) : parmi les lycées proches du point, celui dont
 * le nom partage le plus de mots significatifs avec le nom extrait (le plus proche en cas
 * d'égalité) ; à défaut de nom concordant, le seul lycée à moins de 250 m.
 */
export function pickByGeo(
  candidates: ReadonlyArray<NearbyCandidate>,
  extractedName: string,
): NearbyCandidate | null {
  if (candidates.length === 0) return null
  const words = new Set(
    stripGenericWords(extractedName)
      .split(' ')
      .filter((w) => w.length > 2),
  )
  const scored = candidates
    .map((c) => ({
      c,
      overlap: stripGenericWords(c.name)
        .split(' ')
        .filter((w) => words.has(w)).length,
    }))
    .sort((a, b) => b.overlap - a.overlap || a.c.distance_m - b.c.distance_m)
  const best = scored[0]
  if (best && best.overlap > 0) return best.c
  const veryClose = candidates.filter((c) => c.distance_m <= 250)
  return veryClose.length === 1 ? (veryClose[0] ?? null) : null
}
