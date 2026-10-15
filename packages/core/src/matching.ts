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
  /** Used to prefer a lycée for a bare name and a university for "fac de droit". */
  level?: SchoolLevel
}

export const MATCH_THRESHOLDS = {
  minScore: 0.6,
  minNameScore: 0.6,
  minCityScore: 0.5,
  minMargin: 0.05,
  /** Without a known city, the name must be almost exact. */
  minNameScoreWithoutCity: 0.9,
  /** A misspelt name: the city must be the cited one and the school clearly ahead of the others. */
  minNameScoreForTypo: 0.5,
  minCityScoreForTypo: 0.9,
  minTypoGap: 0.2,
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
  // A bare name ("Lumière") is a lycée here; a citation with "fac", "IUT"… wants higher education.
  const wantedLevel = levelOfName(cited)
  const rank = (c: SchoolCandidate) =>
    c.score -
    (isAnnex(c.name) ? ANNEX_PENALTY : 0) -
    (cited && c.level && c.level !== wantedLevel ? LEVEL_PENALTY : 0)
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
    if (
      best.nameScore < t.minNameScore ||
      best.cityScore < t.minCityScore ||
      best.score < t.minScore
    )
      return misspelled(best, ranked, t, cited)
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
      !sameInstitution(best, c) &&
      (isAnnex(best.name) || !isAnnex(c.name)) &&
      !(isExact(best) && !isExact(c)),
  )
  return rival ? null : best
}

/**
 * A name too far from the school's for the usual threshold ("Marlherbe" for Malherbe) is still
 * the one when the city is exactly the cited one and no other school of that city comes close.
 */
function misspelled(
  best: SchoolCandidate,
  ranked: ReadonlyArray<SchoolCandidate>,
  t: typeof MATCH_THRESHOLDS,
  cited: string,
): SchoolCandidate | null {
  if (best.cityScore < t.minCityScoreForTypo || best.nameScore < t.minNameScoreForTypo) return null
  // Only a typo: a word of the citation is one or two letters away from a word of the school's
  // name (the city's own words say nothing, "Catho d'Angers" is not "Université d'Angers").
  const own = new Set(normalizeWords(best.city))
  const distinctive = (s: string) =>
    stripGenericWords(s)
      .split(' ')
      .filter((w) => w.length >= 5 && !own.has(w))
  const theirs = distinctive(best.name)
  const close = distinctive(cleanCitation(cited)).some((w) =>
    theirs.some((v) => editDistance(w, v) <= (w.length >= 8 ? 2 : 1)),
  )
  if (!close) return null
  const next = ranked.find((c) => c.uai !== best.uai && !sameSite(best, c))
  return next && next.nameScore > best.nameScore - t.minTypoGap ? null : best
}

/** Levenshtein distance, for words of a few letters. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    prev = row
  }
  return prev[b.length] ?? 0
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  quot: '"',
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  laquo: '«',
  raquo: '»',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  auml: 'ä',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  ouml: 'ö',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yuml: 'ÿ',
  oelig: 'œ',
  Eacute: 'É',
  Egrave: 'È',
  Ecirc: 'Ê',
  Agrave: 'À',
  Ccedil: 'Ç',
  Icirc: 'Î',
  Ocirc: 'Ô',
  Ucirc: 'Û',
  OElig: 'Œ',
}

/** Names scraped from HTML can still carry "&egrave;" or "&#233;": decode them before matching. */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu, (whole, dec, hex, name) => {
    if (dec || hex) {
      const code = dec ? Number(dec) : parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[name as string] ?? whole
  })
}

/**
 * What a citation names once the words that do not belong to the name are gone: "cité scolaire
 * Mistral" cites the lycée Mistral, "institution Sacré-Cœur" the school Sacré-Cœur.
 */
export function cleanCitation(name: string): string {
  return decodeEntities(name)
    .replace(/\bcit[ée]s?\s+scolaires?\b/giu, ' ')
    .replace(/\bgroupes?\s+scolaires?\b/giu, ' ')
    .replace(/\binstitution\b/giu, ' ')
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

/** Words of a school's name that only say what kind of place it is: no school is picked on them. */
export const WEAK_NAME_WORDS = [
  'ecole',
  'ecoles',
  'institut',
  'centre',
  'groupe',
  'ensemble',
  'college',
  'section',
  'cfa',
  'enseignement',
  'formation',
  'scolaire',
  'superieur',
  'superieure',
  'national',
  'nationale',
] as const

const ANNEX_PENALTY = 0.12
const LEVEL_PENALTY = 0.1

/**
 * The institution a directory record belongs to: "Université Jean Moulin - Lyon 3 – Lyon 7e" and
 * "… – Lyon 8e" are two sites (two UAIs) of one university, whatever the site a citation means.
 */
export function institutionKey(name: string): string {
  return normalizeWords(name.split(/\s[–—]\s/u)[0] ?? name).join(' ')
}

/** Two sites of one university in the same city: not rivals, any of them carries the report. */
function sameInstitution(a: SchoolCandidate, b: SchoolCandidate): boolean {
  return (
    a.level === 'higher' &&
    b.level === 'higher' &&
    a.city === b.city &&
    institutionKey(a.name) === institutionKey(b.name)
  )
}

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

export function normalizeWords(s: string): string[] {
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
  const higher = [
    'universite',
    'universites',
    'fac',
    'faculte',
    'facultes',
    'iut',
    'ufr',
    'campus',
    'iep',
    'inspe',
    'espe',
    'universitaire',
  ]
  if (words.some((w) => higher.includes(w))) return 'higher'
  return words.join(' ').includes('sciences po') ? 'higher' : 'secondary'
}

/** True when the name designates no specific school: "Lycée", "lycée de Hanches", "Université". */
export function isGenericSchoolName(name: string, city: string | null): boolean {
  const stripped = stripGenericWords(cleanCitation(name))
  const cityWords = stripGenericWords(decodeEntities(city ?? ''))
  // "lycée agricole de Saint-Aubin" names a kind of school and a town, not a school.
  const bare = stripped
    .split(' ')
    .filter((w) => !KIND_WORDS.has(w))
    .join(' ')
  return stripped === '' || bare === '' || bare === cityWords
}

const KIND_WORDS = new Set(['agricole', 'agricoles', 'hotelier', 'horticole', 'maritime'])

/**
 * A higher-education citation that names no institution, only a part of one: "fac de droit", "IUT",
 * "campus de la Fonderie", "pôle universitaire". Its city's university is the likely answer.
 */
export function isPartOfUniversity(name: string): boolean {
  const words = normalizeWords(cleanCitation(name))
  const parts = [
    'fac',
    'faculte',
    'facultes',
    'iut',
    'ufr',
    'campus',
    'universitaire',
    'inspe',
    'espe',
  ]
  return words.some((w) => parts.includes(w)) && !words.some((w) => w === 'lycee' || w === 'lycees')
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
