// Banc d'essai d'un « juge » (second avis sur chaque signalement candidat) : fonctions pures,
// testées dans tests/eval-judge.test.ts. Le juge répond à « cet article dit-il que cet
// établissement est bloqué ou fermé à cette date ? » avec une probabilité ; on cherche le seuil
// qui écarte des faux sans perdre de vrais, sur les signalements jugés à la main.

export interface JudgedOutcome {
  /** Verdict de l'audit manuel : le signalement est-il vrai ? */
  label: 'oui' | 'non'
  /** Probabilité (0 à 1) donnée par le juge que le fait est vrai ; null si pas de réponse. */
  probability: number | null
}

export interface SweepRow {
  threshold: number
  /** Vrais gardés (probabilité ≥ seuil) sur le total des vrais. */
  trueKept: number
  trueTotal: number
  /** Faux écartés (probabilité < seuil) sur le total des faux. */
  falseRemoved: number
  falseTotal: number
}

/** Pour chaque seuil : combien de vrais on garde et combien de faux on écarte. */
export function sweep(
  outcomes: ReadonlyArray<JudgedOutcome>,
  thresholds: ReadonlyArray<number> = [0.5, 0.6, 0.7, 0.8, 0.9],
): SweepRow[] {
  const answered = outcomes.filter((o) => o.probability !== null)
  const vrais = answered.filter((o) => o.label === 'oui')
  const faux = answered.filter((o) => o.label === 'non')
  return thresholds.map((threshold) => ({
    threshold,
    trueKept: vrais.filter((o) => (o.probability as number) >= threshold).length,
    trueTotal: vrais.length,
    falseRemoved: faux.filter((o) => (o.probability as number) < threshold).length,
    falseTotal: faux.length,
  }))
}

/**
 * Seuil recommandé : le plus haut qui garde au moins `minKept` (95 % par défaut) des vrais.
 * undefined si aucun seuil ne tient, c'est-à-dire que le juge ne vaut pas la peine.
 */
export function bestThreshold(rows: ReadonlyArray<SweepRow>, minKept = 0.95): SweepRow | undefined {
  return [...rows]
    .filter((r) => r.trueTotal > 0 && r.trueKept / r.trueTotal >= minKept)
    .sort((a, b) => b.threshold - a.threshold)[0]
}

/** Estimation du coût d'un lot : tokens d'entrée estimés (≈ 1 token pour 3,5 caractères en français). */
export function estimateTokens(texts: ReadonlyArray<string>): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3.5)
}
