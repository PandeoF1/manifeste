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

/**
 * Vrai si le nom ne désigne aucun lycée précis : « Lycée », « lycée de Hanches »
 * (miroir de public.is_generic_school_name).
 */
export function isGenericSchoolName(name: string, city: string | null): boolean {
  const stripped = stripGenericWords(name)
  return stripped === '' || stripped === stripGenericWords(city ?? '')
}
