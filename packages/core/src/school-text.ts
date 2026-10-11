/**
 * Spotting a school in a text. Shared by collection, audits and the parser benchmark.
 * Names are French, so the comparisons work on lowercase text without accents.
 */

/** Words every school name has: they never identify one. */
export const GENERIC_NAME_WORDS: ReadonlySet<string> = new Set(
  'lycee polyvalent professionnel professionnelle technologique general generale metiers prive public universite institut ecole saint sainte'.split(
    ' ',
  ),
)

/** Lowercase, accents removed ("Lycée" -> "lycee"). */
export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Distinctive words of the school's name (not "lycée", "professionnel"…). */
function nameKeys(school: { name: string }): string[] {
  return (norm(school.name).match(/[a-z]{5,}/g) ?? []).filter((w) => !GENERIC_NAME_WORDS.has(w))
}

/** Words that identify a school in text: distinctive name words, then the city's. */
function mentionKeys(school: { name: string; city: string }): string[] {
  return [...nameKeys(school), ...(norm(school.city).match(/[a-z]{4,}/g) ?? [])]
}

/**
 * True when a text mentions the school: a distinctive word of its name, or its city.
 * `strict` leaves the city out whenever the name has a distinctive word, so a menu that lists
 * "Paris" does not count as a mention of "Lycée Charlemagne" (used to score parsers).
 */
export function mentionsSchool(
  text: string,
  school: { name: string; city: string },
  options: { strict?: boolean } = {},
): boolean {
  const t = norm(text)
  const names = nameKeys(school)
  const keys = options.strict && names.length > 0 ? names : mentionKeys(school)
  return keys.some((k) => t.includes(k))
}

/** Sentences of the text that talk about the school (distinctive name or city), at most `max`. */
export function sentencesAbout(
  text: string,
  school: { name: string; city: string },
  max = 4,
): string[] {
  const keys = mentionKeys(school)
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter((sentence) => keys.some((k) => norm(sentence).includes(k)))
    .slice(0, max)
}

const STOP = new Set<string>('de du des la le les et en d l'.split(' '))

export type SchoolMatch = 'yes' | 'city' | 'no'

/**
 * Does an extracted event talk about this school?
 *  - "yes": a distinctive word of the name (or its acronym: "ENS" for École normale supérieure);
 *  - "city": same city but the name is not recognised (several schools possible);
 *  - "no": nothing in common.
 * A university whose only distinctive word is its city ("Université de Nantes") is recognised
 * by the city.
 */
export function matchSchool(
  event: { schoolName: string; city: string | null },
  school: { name: string; city: string },
): SchoolMatch {
  const name = norm(event.schoolName)
  const cityWords: string[] = norm(school.city).match(/[a-z]{4,}/g) ?? []
  const keys = (norm(school.name).match(/[a-z]{5,}/g) ?? []).filter(
    (w) => !GENERIC_NAME_WORDS.has(w),
  )
  const sameCity = norm(event.city) === norm(school.city) || cityWords.some((w) => name.includes(w))
  if (keys.some((k) => name.includes(k))) return 'yes'
  const initials = (norm(school.name).match(/[a-z]+/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => w[0])
    .join('')
  if (initials.length >= 3 && new RegExp(`\\b${initials}\\b`).test(name)) return 'yes'
  if (!keys.length || keys.every((k) => cityWords.includes(k))) return sameCity ? 'yes' : 'no'
  return sameCity ? 'city' : 'no'
}

export const sameSchool = (
  event: { schoolName: string; city: string | null },
  school: { name: string; city: string },
): boolean => matchSchool(event, school) === 'yes'
