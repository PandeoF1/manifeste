import { describe, expect, test } from 'bun:test'
import {
  auc,
  bestThreshold,
  percentile,
  summarizeExtract,
  summarizeJudge,
  sweep,
  type ExtractOutcome,
  type JudgeOutcome,
} from './metrics.ts'

const j = (
  label: 'yes' | 'no',
  probability: number | null,
  nature: JudgeOutcome['nature'] = null,
): JudgeOutcome => ({ label, probability, nature })

describe('judge metrics', () => {
  test('AUC: perfect, reversed, coin flip, ties, unanswered', () => {
    expect(auc([j('yes', 0.9), j('yes', 0.8), j('no', 0.2), j('no', 0.1)])).toBe(1)
    expect(auc([j('yes', 0.1), j('no', 0.9)])).toBe(0)
    expect(auc([j('yes', 0.5), j('no', 0.5)])).toBe(0.5)
    expect(auc([j('yes', 0.9), j('no', null), j('no', 0.2)])).toBe(1) // unanswered left out
    expect(auc([j('yes', 0.9)])).toBeNull() // needs both classes
  })

  test('sweep and best threshold: the highest one that keeps 95% of true reports', () => {
    const outcomes = [
      ...Array.from({ length: 20 }, (_, i) => j('yes', i === 0 ? 0.35 : 0.9)), // one true at 0.35
      ...Array.from({ length: 10 }, () => j('no', 0.2)),
    ]
    const rows = sweep(outcomes, [0.3, 0.5, 0.9])
    expect(rows.map((r) => [r.threshold, r.trueKept, r.falseRemoved])).toEqual([
      [0.3, 20, 10],
      [0.5, 19, 10],
      [0.9, 19, 10],
    ])
    expect(bestThreshold(rows)?.threshold).toBe(0.9) // 19/20 = 95% kept
    expect(bestThreshold(rows, 1)?.threshold).toBe(0.3)
    expect(bestThreshold([], 0.95)).toBeUndefined()
  })

  test('summary reports nature confusion', () => {
    const s = summarizeJudge([
      j('yes', 0.9, 'blockade'),
      j('yes', 0.8, 'closed'),
      j('no', 0.2, 'gathering'),
      j('no', 0.6, 'blockade'),
      j('no', null),
    ])
    expect(s).toMatchObject({ n: 5, answered: 4, blockadeOnFalse: 0.5, blockadeOrClosedOnTrue: 1 })
  })
})

describe('extraction metrics', () => {
  const x = (over: Partial<ExtractOutcome>): ExtractOutcome => ({
    label: 'yes',
    kept: true,
    status: 'blocked',
    expectedStatus: 'blocked',
    answered: true,
    ...over,
  })

  test('kept rates and status accuracy; unanswered cases are left out', () => {
    const s = summarizeExtract([
      x({}),
      x({ status: 'lifted' }), // kept, wrong status
      x({ kept: false, status: null }),
      x({ label: 'no', expectedStatus: 'none' }), // a false report still kept
      x({ label: 'no', kept: false, status: null, expectedStatus: 'none' }),
      x({ answered: false }),
    ])
    expect(s.n).toBe(6)
    expect(s.answered).toBe(5)
    expect(s.trueKept).toEqual({ kept: 2, total: 3 })
    expect(s.falseKept).toEqual({ kept: 1, total: 2 })
    expect(s.statusCorrect).toEqual({ correct: 1, total: 2 })
  })

  test('percentile', () => {
    expect(percentile([], 50)).toBe(0)
    expect(percentile([5, 1, 3], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
  })
})
