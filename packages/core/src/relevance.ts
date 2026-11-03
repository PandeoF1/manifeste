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

/**
 * A street demonstration, whatever the cause: the filter of the "mobilisations signalées"
 * (a wide net, the AI decides). A strike alone is not one: it needs a gathering or a march.
 */
const DEMONSTRATION_WORDS =
  /\b(manifest\w*|cortege\w*|defil(e|es|er|ent|ant|ants)|rassemblement\w*|sit-in|marche (pour|contre|blanche|citoyenne|climat)|piquets? de greve|blocage\w*|mobilisation\w*)\b/

export function isDemonstration(text: string): boolean {
  return DEMONSTRATION_WORDS.test(plainText(text))
}

export function isRelevant(text: string): boolean {
  const t = plainText(text)
  return LEGACY_KEYWORDS.test(t) || (SCHOOL_WORDS.test(t) && BLOCKING_WORDS.test(t))
}
