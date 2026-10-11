/** Scores for the AI benchmarks. Pure and tested. */
import type { JudgeNature, ReportStatus } from '@manifeste/core'

export interface JudgeOutcome {
  label: 'yes' | 'no'
  /** null when the judge gave no answer. */
  probability: number | null
  nature: JudgeNature | null
}

/**
 * ROC AUC: the chance that a true report gets a higher probability than a false one (ties count
 * half). 0.5 is a coin flip, 1 a perfect judge. Independent of any threshold.
 */
export function auc(outcomes: readonly JudgeOutcome[]): number | null {
  const answered = outcomes.filter((o) => o.probability !== null)
  const yes = answered.filter((o) => o.label === 'yes')
  const no = answered.filter((o) => o.label === 'no')
  if (yes.length === 0 || no.length === 0) return null
  let wins = 0
  for (const a of yes)
    for (const b of no) {
      const pa = a.probability as number
      const pb = b.probability as number
      wins += pa > pb ? 1 : pa === pb ? 0.5 : 0
    }
  return wins / (yes.length * no.length)
}

export interface SweepRow {
  threshold: number
  trueKept: number
  trueTotal: number
  falseRemoved: number
  falseTotal: number
}

/** For each threshold: how many true reports are kept and how many false ones are dropped. */
export function sweep(
  outcomes: readonly JudgeOutcome[],
  thresholds: readonly number[] = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
): SweepRow[] {
  const answered = outcomes.filter((o) => o.probability !== null)
  const yes = answered.filter((o) => o.label === 'yes')
  const no = answered.filter((o) => o.label === 'no')
  return thresholds.map((threshold) => ({
    threshold,
    trueKept: yes.filter((o) => (o.probability as number) >= threshold).length,
    trueTotal: yes.length,
    falseRemoved: no.filter((o) => (o.probability as number) < threshold).length,
    falseTotal: no.length,
  }))
}

/** The highest threshold that keeps at least `minKept` of the true reports; undefined if none does. */
export function bestThreshold(rows: readonly SweepRow[], minKept = 0.95): SweepRow | undefined {
  return [...rows]
    .filter((r) => r.trueTotal > 0 && r.trueKept / r.trueTotal >= minKept)
    .sort((a, b) => b.threshold - a.threshold)[0]
}

export interface JudgeSummary {
  n: number
  answered: number
  auc: number | null
  sweep: SweepRow[]
  best: SweepRow | null
  /** Share of false reports the judge calls a blockade (what it should not). */
  blockadeOnFalse: number | null
  /** Share of true reports the judge calls a blockade or a closure. */
  blockadeOrClosedOnTrue: number | null
}

const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole)

export function summarizeJudge(outcomes: readonly JudgeOutcome[]): JudgeSummary {
  const rows = sweep(outcomes)
  const yes = outcomes.filter((o) => o.label === 'yes' && o.nature)
  const no = outcomes.filter((o) => o.label === 'no' && o.nature)
  return {
    n: outcomes.length,
    answered: outcomes.filter((o) => o.probability !== null).length,
    auc: auc(outcomes),
    sweep: rows,
    best: bestThreshold(rows) ?? null,
    blockadeOnFalse: share(no.filter((o) => o.nature === 'blockade').length, no.length),
    blockadeOrClosedOnTrue: share(
      yes.filter((o) => o.nature === 'blockade' || o.nature === 'closed').length,
      yes.length,
    ),
  }
}

export interface ExtractOutcome {
  label: 'yes' | 'no'
  /** The model produced a usable event about this school. */
  kept: boolean
  /** Status of the kept event. */
  status: ReportStatus | null
  /** Status a human read in the article (the claimed one unless the audit corrected it). */
  expectedStatus: ReportStatus | 'none'
  /** False when the call failed or no recording exists: left out of every rate. */
  answered: boolean
}

export interface ExtractSummary {
  n: number
  answered: number
  /** True reports still kept: the model must not lose them. */
  trueKept: { kept: number; total: number }
  /** False reports kept: what a better prompt should remove. */
  falseKept: { kept: number; total: number }
  /** Among kept true reports, those with the right status. */
  statusCorrect: { correct: number; total: number }
}

export function summarizeExtract(outcomes: readonly ExtractOutcome[]): ExtractSummary {
  const answered = outcomes.filter((o) => o.answered)
  const yes = answered.filter((o) => o.label === 'yes')
  const no = answered.filter((o) => o.label === 'no')
  const keptYes = yes.filter((o) => o.kept && o.expectedStatus !== 'none')
  return {
    n: outcomes.length,
    answered: answered.length,
    trueKept: { kept: yes.filter((o) => o.kept).length, total: yes.length },
    falseKept: { kept: no.filter((o) => o.kept).length, total: no.length },
    statusCorrect: {
      correct: keptYes.filter((o) => o.status === o.expectedStatus).length,
      total: keptYes.length,
    },
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}
