/**
 * Choosing the school an extracted name refers to. Candidates come from the trigram search in
 * Postgres; these rules decide whether the best one is clear enough to attach a report to.
 */
import type { SchoolLevel } from './status.ts'

export interface SchoolCandidate {
  uai: string
  name: string
  city: string
  nameScore: number
  cityScore: number
  score: number
  /** Position, used to recognise twins of one site. */
  lat?: number | null
  lng?: number | null
}

export const MATCH_THRESHOLDS = {
  minScore: 0.6,
  minNameScore: 0.6,
  minCityScore: 0.5,
  minMargin: 0.05,
  /** Without a known city, the name must be almost exact. */
  minNameScoreWithoutCity: 0.9,
} as const

/** Two records of one site (general and vocational lycée of the same name) within this distance. */
export const TWIN_RADIUS_M = 250

/**
 * Picks a school only when the best candidate is clear: score high enough, consistent city when
 * known, and a margin over the runner-up (else a likely namesake: better attach nothing).
 */
export function pickMatch(
  candidates: ReadonlyArray<SchoolCandidate>,
  hasCity: boolean,
  t: typeof MATCH_THRESHOLDS = MATCH_THRESHOLDS,
  cited = '',
): SchoolCandidate | null {
  // An annex ranks just behind the school it belongs to: its name is the same, so a stray
  // article or a missing "d'" would otherwise put it first.
  const rank = (c: SchoolCandidate) => c.score - (isAnnex(c.name) ? ANNEX_PENALTY : 0)
  // A citation of a "lycée professionnel" wants the vocational school; any other wants the
  // general or polyvalent twin first (that is where lycéens block).
  const wantsVocational = normalizeWords(cited).some((w) => w === 'professionnel' || w === 'lp')
  // In a known city, the school whose name is exactly the cited one wins over a longer name that
  // contains it ("Lycée Saint-Charles" over "Lycée Saint-Charles Camas"). Without a city the
  // longer name may be the right school of another town, so only a human can tell.
  const wanted = hasCity ? stripGenericWords(cleanCitation(cited)) : ''
  const isExact = (c: SchoolCandidate) => wanted !== '' && stripGenericWords(c.name) === wanted
  // Same score: the exact name, the twin that fits the citation, then the shortest (least specific) name,
  // "Lycée Condorcet" before "Lycée professionnel Condorcet", then the UAI so the choice is stable.
  const ranked = [...candidates].sort(
    (a, b) =>
      rank(b) - rank(a) ||
      Number(isExact(b)) - Number(isExact(a)) ||
      Number(isVocational(a.name) !== wantsVocational) -
        Number(isVocational(b.name) !== wantsVocational) ||
      a.name.length - b.name.length ||
      a.uai.localeCompare(b.uai),
  )
  const best = ranked[0]
  if (!best) return null
  if (hasCity) {
    if (best.nameScore < t.minNameScore || best.cityScore < t.minCityScore) return null
    if (best.score < t.minScore) return null
  } else if (best.nameScore < t.minNameScoreWithoutCity) {
    return null
  }
  // A close rival = likely namesake. Twins of one site (each with its own UAI) do not count,
  // nor do the annexes of the school itself.
  const rival = ranked.find(
    (c) =>
      c.uai !== best.uai &&
      rank(best) - rank(c) < t.minMargin &&
      !sameSite(best, c) &&
      (isAnnex(best.name) || !isAnnex(c.name)) &&
      !(isExact(best) && !isExact(c)),
  )
  return rival ? null : best
}

/** "cité scolaire Mistral" cites the lycée Mistral: the kind of place is not part of its name. */
export function cleanCitation(name: string): string {
  return name
    .replace(/\bcit[ée]s?\s+scolaires?\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A record of the directory that is a part of a school, not a school: "Section d'enseignement
 * professionnel du lycée polyvalent Rimbaud" has its own UAI and the name of its lycée, so it
 * always ties with it.
 */
export function isAnnex(name: string): boolean {
  const first = normalizeWords(name)[0]
  return first !== undefined && ANNEX_FIRST_WORDS.has(first)
}

const ANNEX_PENALTY = 0.12

/** A vocational-only lycée ("lycée professionnel X"), as opposed to a general or polyvalent one. */
function isVocational(name: string): boolean {
  const words = normalizeWords(name)
  return words.includes('professionnel') && !words.includes('polyvalent')
}

const ANNEX_FIRST_WORDS = new Set(['section', 'sep', 'segpa', 'sgt', 'annexe', 'antenne', 'micro'])

/** Distance in metres (equirectangular approximation, plenty at a few hundred metres). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.sqrt(x * x + y * y) * 6_371_000
}

function sameSite(a: SchoolCandidate, b: SchoolCandidate): boolean {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false
  if (stripGenericWords(a.name) !== stripGenericWords(b.name)) return false
  return distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) <= TWIN_RADIUS_M
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** The name without generic words (mirrored by strip_generic_words in SQL). */
export function stripGenericWords(name: string): string {
  return normalizeWords(name)
    .filter((w) => !GENERIC_WORDS.has(w))
    .join(' ')
}

/** Level of a school from the cited name ("Université de Nanterre", "fac de Tolbiac"). */
export function levelOfName(name: string): SchoolLevel {
  const words = normalizeWords(name)
  if (words.includes('lycee') || words.includes('lycees')) return 'secondary'
  const higher = ['universite', 'universites', 'fac', 'faculte', 'iut', 'ufr', 'campus', 'iep']
  if (words.some((w) => higher.includes(w))) return 'higher'
  return words.join(' ').includes('sciences po') ? 'higher' : 'secondary'
}

/** True when the name designates no specific school: "Lycée", "lycée de Hanches", "Université". */
export function isGenericSchoolName(name: string, city: string | null): boolean {
  const stripped = stripGenericWords(name)
  return stripped === '' || stripped === stripGenericWords(city ?? '')
}

export interface NearbyCandidate {
  uai: string
  name: string
  distanceM: number
}

/**
 * Attaching by position (a point on a collaborative map): among nearby schools, the one whose
 * name shares the most significant words with the extracted name (the nearest on a tie);
 * failing that, the only school within 250 m.
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
    .sort((a, b) => b.overlap - a.overlap || a.c.distanceM - b.c.distanceM)
  const best = scored[0]
  if (best && best.overlap > 0) return best.c
  const veryClose = candidates.filter((c) => c.distanceM <= TWIN_RADIUS_M)
  return veryClose.length === 1 ? (veryClose[0] ?? null) : null
}
