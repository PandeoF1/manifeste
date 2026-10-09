import { describe, expect, it } from 'vitest'
import { bestThreshold, estimateTokens, sweep, type JudgedOutcome } from '../scripts/eval-judge-lib'

const rows: JudgedOutcome[] = [
  { label: 'oui', probability: 0.95 },
  { label: 'oui', probability: 0.85 },
  { label: 'oui', probability: 0.75 },
  { label: 'oui', probability: 0.55 },
  { label: 'non', probability: 0.9 },
  { label: 'non', probability: 0.65 },
  { label: 'non', probability: 0.3 },
  { label: 'non', probability: null },
]

describe('sweep', () => {
  it('compte vrais gardés et faux écartés par seuil, sans les réponses manquantes', () => {
    const s = sweep(rows, [0.5, 0.8])
    expect(s[0]).toMatchObject({ trueKept: 4, trueTotal: 4, falseRemoved: 1, falseTotal: 3 })
    expect(s[1]).toMatchObject({ trueKept: 2, trueTotal: 4, falseRemoved: 2, falseTotal: 3 })
  })
})

describe('bestThreshold', () => {
  it('prend le seuil le plus haut qui garde assez de vrais', () => {
    expect(bestThreshold(sweep(rows), 1)?.threshold).toBe(0.5)
    expect(bestThreshold(sweep(rows), 0.5)?.threshold).toBe(0.8)
  })
  it('undefined quand aucun seuil ne tient', () => {
    expect(bestThreshold(sweep([{ label: 'oui', probability: 0.1 }], [0.5]), 0.95)).toBeUndefined()
  })
})

describe('estimateTokens', () => {
  it('estime grossièrement', () => {
    expect(estimateTokens(['a'.repeat(350), 'b'.repeat(350)])).toBe(200)
  })
})
