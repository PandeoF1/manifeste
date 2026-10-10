// Banc d'essai d'un « juge » (second avis sur chaque signalement candidat) : fonctions pures,
// testées dans tests/eval-judge.test.ts. Le juge répond à « cet article dit-il que cet
// établissement est bloqué ou fermé à cette date ? » avec une probabilité ; on cherche le seuil
// qui écarte des faux sans perdre de vrais, sur les signalements jugés à la main.

import {
  JEV_USD_PER_INPUT_TOKEN,
  JUDGE_NATURES,
  JUDGE_LEVELS,
  buildQuestions,
  focusState,
  parseJevResponse,
  type JudgeAnswer,
} from '../supabase/functions/_shared/judge.ts'

export {
  JEV_USD_PER_INPUT_TOKEN,
  JUDGE_LEVELS,
  JUDGE_NATURES,
  buildQuestions,
  focusState,
  parseJevResponse,
}
export type { JudgeAnswer }

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

// --- Comparaison par groupes (Gemini seul, puis Gemini + juge) --------------------------------------

export type GroupBy = 'domain' | 'day' | 'status' | 'level' | 'certainty'

export interface ReportRow {
  id: string
  day: string
  domain: string
  status: string
  level: string
  certainty: string | null
  probability: number | null
  nature: string | null
  /** Niveau annoncé par le juge avec assez de certitude, s'il contredit la base. */
  levelConflict: boolean
}

export function groupKey(r: ReportRow, by: GroupBy): string {
  return by === 'domain'
    ? r.domain
    : by === 'day'
      ? r.day
      : by === 'status'
        ? r.status
        : by === 'level'
          ? r.level
          : (r.certainty ?? 'sans')
}

export type Zone = 'garde' | 'incertain' | 'retire' | 'non-juge'

/** garde ≥ seuil ; incertain entre le seuil bas et le seuil ; retiré en dessous ; non-juge sans réponse. */
export function zoneOf(r: ReportRow, keep = 0.5, low = 0.3): Zone {
  if (r.levelConflict) return 'retire'
  if (r.probability === null) return 'non-juge'
  return r.probability >= keep ? 'garde' : r.probability >= low ? 'incertain' : 'retire'
}

export interface GroupSummary {
  group: string
  n: number
  garde: number
  incertain: number
  retire: number
  nonJuge: number
  natures: Record<string, number>
}

export function summarizeGroups(
  rows: ReadonlyArray<ReportRow>,
  by: GroupBy,
  keep = 0.5,
  low = 0.3,
): GroupSummary[] {
  const map = new Map<string, GroupSummary>()
  for (const r of rows) {
    const key = groupKey(r, by)
    const g = map.get(key) ?? {
      group: key,
      n: 0,
      garde: 0,
      incertain: 0,
      retire: 0,
      nonJuge: 0,
      natures: {},
    }
    g.n++
    const z = zoneOf(r, keep, low)
    if (z === 'garde') g.garde++
    else if (z === 'incertain') g.incertain++
    else if (z === 'retire') g.retire++
    else g.nonJuge++
    if (r.nature) g.natures[r.nature] = (g.natures[r.nature] ?? 0) + 1
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => b.n - a.n)
}

/** Le juge est sûr (≥ 0,8) d'un niveau qui contredit celui de la base (hors « inconnu »). */
export function conflictsWithBase(
  schoolLevel: string,
  answer: Pick<JudgeAnswer, 'level' | 'levelProbabilities'>,
): boolean {
  const level = answer.level
  if (!level || level === 'inconnu') return false
  return level !== schoolLevel && (answer.levelProbabilities?.[level] ?? 0) >= 0.8
}

export { chiffres, tierOf } from '../supabase/functions/_shared/judge-tiers.ts'
export type { Chiffres, RapportRow, Tier } from '../supabase/functions/_shared/judge-tiers.ts'
