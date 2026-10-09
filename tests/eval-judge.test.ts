import { describe, expect, it } from 'vitest'
import {
  bestThreshold,
  buildQuestions,
  estimateTokens,
  parseJevResponse,
  sweep,
  type JudgedOutcome,
} from '../scripts/eval-judge-lib'

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

describe('Jev : questions et réponse', () => {
  it('pose une question « bloque » (noul) et une question « nature » (choice) sur l’établissement', () => {
    const q = buildQuestions({ name: 'Lycée Victor Hugo', city: 'Besançon' })
    expect(q.bloque?.type).toBe('noul')
    expect(q.bloque?.instructions).toContain('Lycée Victor Hugo')
    expect(q.bloque?.instructions).toContain('Besançon')
    expect(q.nature?.type).toBe('choice')
    expect(Object.keys(q.nature?.criteria ?? {})).toEqual([
      'blocage',
      'ferme',
      'rassemblement',
      'incident',
      'autre',
    ])
  })
  it('lit la probabilité et la nature de la réponse', () => {
    const a = parseJevResponse({
      model: 'jev-1.13.0',
      answers: {
        bloque: { type: 'noul', noul: 0.82 },
        nature: {
          type: 'choice',
          choice: 'ferme',
          confidence: 0.7,
          probabilities: { ferme: 0.7, blocage: 0.3 },
        },
      },
    })
    expect(a).toEqual({
      probability: 0.82,
      nature: 'ferme',
      natureProbabilities: { ferme: 0.7, blocage: 0.3 },
    })
  })
  it('tolère une réponse incomplète ou inattendue', () => {
    expect(parseJevResponse(null)).toEqual({
      probability: null,
      nature: null,
      natureProbabilities: {},
    })
    expect(
      parseJevResponse({ answers: { bloque: { noul: 3 }, nature: { choice: 'inconnu' } } }),
    ).toMatchObject({
      probability: null,
      nature: null,
    })
  })
})
