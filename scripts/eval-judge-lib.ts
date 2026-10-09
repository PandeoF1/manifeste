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

// --- Jev (TypeSafe AI) : POST https://api.typesafe.ai/v1/systemone ---------------------------------

/** Natures proposées au juge (la question « nature » donne la répartition, pas la décision). */
export const JUDGE_NATURES = {
  blocage: "des élèves ou étudiants empêchent ou gênent l'entrée (barrage, blocus, poubelles)",
  ferme: 'établissement fermé ou en cours à distance, sans élèves qui bloquent',
  rassemblement: 'élèves rassemblés ou manifestant devant ou en ville, sans gêner ni fermer',
  incident: 'incident (tirs de mortiers, incendie, agression, dégradations) sans blocage dit',
  autre:
    'récit passé, aperçu de ce qui pourrait se passer, opinion, ou pas de fait sur cet établissement',
} as const
export type JudgeNature = keyof typeof JUDGE_NATURES

export interface JevQuestion {
  type: 'noul' | 'choice'
  instructions: string
  criteria?: Record<string, string>
}

/** Questions posées pour un établissement cité dans un article. */
export function buildQuestions(school: {
  name: string
  city: string
}): Record<string, JevQuestion> {
  const who = `« ${school.name} » (${school.city})`
  return {
    bloque: {
      type: 'noul',
      instructions:
        `À la date de publication de l'article, le texte dit-il que ${who} est bloqué par des élèves ou des étudiants, ` +
        `ou fermé ou passé à distance à cause de la mobilisation ? Réponds non s'il s'agit seulement d'un rassemblement, ` +
        `d'un incident, d'un récit passé, d'un aperçu de ce qui pourrait arriver ou d'une opinion.`,
    },
    nature: {
      type: 'choice',
      instructions: `Que dit le texte de ${who} ?`,
      criteria: { ...JUDGE_NATURES },
    },
  }
}

export interface JudgeAnswer {
  /** Probabilité que le fait soit vrai (question « bloque »). */
  probability: number | null
  nature: JudgeNature | null
  natureProbabilities: Record<string, number>
}

/** Lit la réponse de /v1/systemone ; tolère les champs manquants (null). */
export function parseJevResponse(raw: unknown): JudgeAnswer {
  const answers = (raw as { answers?: Record<string, Record<string, unknown>> } | null)?.answers
  const noul = answers?.bloque?.noul
  const choice = answers?.nature?.choice
  const probs = answers?.nature?.probabilities
  return {
    probability: typeof noul === 'number' && noul >= 0 && noul <= 1 ? noul : null,
    nature: typeof choice === 'string' && choice in JUDGE_NATURES ? (choice as JudgeNature) : null,
    natureProbabilities:
      probs && typeof probs === 'object'
        ? Object.fromEntries(
            Object.entries(probs as Record<string, unknown>).filter(
              (e): e is [string, number] => typeof e[1] === 'number',
            ),
          )
        : {},
  }
}

/** Prix annoncé par TypeSafe : 42 $ le milliard de tokens en entrée, sortie gratuite. */
export const JEV_USD_PER_INPUT_TOKEN = 42 / 1_000_000_000
