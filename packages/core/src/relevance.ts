/**
 * Keyword filter before the AI call, so extraction is not paid for off-topic items.
 * Either rule keeps an item:
 * - the original filter, kept as is so nothing it kept is lost;
 * - a school word (lycéens, cité scolaire, fac, campus, Sciences Po…) AND a blocking word
 *   (blocage, fermé, occupé, évacué…).
 * Text is compared without accents or case.
 */
const LEGACY_KEYWORDS =
  /\b(lycees?|lp|lgt|lpo|blocus|bloquee?s?|bloquent|barrage|filtrant|piquet|mobilisation (lyceenne|etudiante))\b/
const SCHOOL_WORDS =
  /\b(lyceen(ne)?s?|lycees?|lp|lgt|lpo|fac|facultes?|universit\w*|campus|iut|sciences po|etudiant\w*|cite scolaire|inspe)\b/
const BLOCKING_WORDS =
  /(blocus|bloqu|blocage|barrage|filtrant|piquet|mobilis|occup|greve|ferme|evacu|manifest|sit-in|rassemblement|incendie|banderole|barricade)/

/** Lowercase, accents removed. */
export const plainText = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function isRelevant(text: string): boolean {
  const t = plainText(text)
  return LEGACY_KEYWORDS.test(t) || (SCHOOL_WORDS.test(t) && BLOCKING_WORDS.test(t))
}
