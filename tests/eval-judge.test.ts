import { describe, expect, it } from 'vitest'
import {
  bestThreshold,
  buildQuestions,
  chiffres,
  tierOf,
  type RapportRow,
  conflictsWithBase,
  focusState,
  estimateTokens,
  parseJevResponse,
  summarizeGroups,
  sweep,
  zoneOf,
  type JudgedOutcome,
  type ReportRow,
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
  it('pour un statut « levé », demande si le blocage est terminé (pas s’il est en cours)', () => {
    const school = { name: 'Lycée Vincent Auriol', city: 'Revel' }
    const levee = buildQuestions(school, 'leve').bloque?.instructions ?? ''
    expect(levee).toContain('est terminé')
    expect(levee).not.toContain('est bloqué par des élèves')
    expect(buildQuestions(school, 'bloque').bloque?.instructions).toContain(
      'est bloqué par des élèves',
    )
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
    expect(a).toMatchObject({
      probability: 0.82,
      nature: 'ferme',
      natureProbabilities: { ferme: 0.7, blocage: 0.3 },
    })
  })
  it('tolère une réponse incomplète ou inattendue', () => {
    expect(parseJevResponse(null)).toMatchObject({
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

const row = (over: Partial<ReportRow>): ReportRow => ({
  id: 'x',
  day: '2026-10-09',
  domain: 'a.fr',
  status: 'bloque',
  level: 'lycee',
  certainty: 'haute',
  probability: 0.9,
  nature: 'blocage',
  levelConflict: false,
  ...over,
})

describe('comparaison par groupes', () => {
  it('classe garde / incertain / retiré selon la probabilité, et retire un niveau contredit', () => {
    expect(zoneOf(row({ probability: 0.8 }))).toBe('garde')
    expect(zoneOf(row({ probability: 0.4 }))).toBe('incertain')
    expect(zoneOf(row({ probability: 0.1 }))).toBe('retire')
    expect(zoneOf(row({ probability: null }))).toBe('non-juge')
    expect(zoneOf(row({ probability: 0.95, levelConflict: true }))).toBe('retire')
  })
  it('résume par groupe, du plus gros au plus petit, avec la répartition des natures', () => {
    const g = summarizeGroups(
      [
        row({ domain: 'a.fr' }),
        row({ domain: 'a.fr', probability: 0.1, nature: 'rassemblement' }),
        row({ domain: 'b.fr', probability: 0.4 }),
      ],
      'domain',
    )
    expect(g.map((x) => x.group)).toEqual(['a.fr', 'b.fr'])
    expect(g[0]).toMatchObject({
      n: 2,
      garde: 1,
      retire: 1,
      natures: { blocage: 1, rassemblement: 1 },
    })
    expect(g[1]).toMatchObject({ n: 1, incertain: 1 })
  })
  it('un niveau contredit seulement si le juge est sûr et ne répond pas « inconnu »', () => {
    expect(
      conflictsWithBase('lycee', { level: 'superieur', levelProbabilities: { superieur: 0.95 } }),
    ).toBe(true)
    expect(
      conflictsWithBase('lycee', { level: 'superieur', levelProbabilities: { superieur: 0.6 } }),
    ).toBe(false)
    expect(
      conflictsWithBase('lycee', { level: 'inconnu', levelProbabilities: { inconnu: 1 } }),
    ).toBe(false)
    expect(
      conflictsWithBase('superieur', { level: 'superieur', levelProbabilities: { superieur: 1 } }),
    ).toBe(false)
  })
  it('envoie au juge le titre et les phrases sur l’établissement, pas tout l’article', () => {
    const text =
      'Le maire a parlé de budget pour la ville. Au lycée Victor Hugo à Besançon, les élèves bloquent l’entrée depuis 7 h. Une météo clémente est prévue demain pour la région.'
    const s = focusState(
      { title: 'Blocus', text },
      { name: 'Lycée Victor Hugo', city: 'Besançon' },
      '2026-10-09',
    )
    expect(s).toContain('Article publié le 2026-10-09')
    expect(s).toContain('Titre : Blocus')
    expect(s).toContain('bloquent l’entrée')
    expect(s).not.toContain('météo')
  })
  it('lit le niveau et ses probabilités dans la réponse', () => {
    const a = parseJevResponse({
      answers: {
        bloque: { noul: 0.7 },
        level: { choice: 'superieur', probabilities: { superieur: 0.9, lycee: 0.1 } },
      },
    })
    expect(a.level).toBe('superieur')
    expect(a.levelProbabilities).toEqual({ superieur: 0.9, lycee: 0.1 })
  })
})

describe('niveaux', () => {
  it('confirmé, mobilisé ou non retenu selon probabilité et nature', () => {
    expect(tierOf({ probability: 0.8, nature: 'blocage' })).toBe('confirme')
    expect(tierOf({ probability: 0.6, nature: 'ferme' })).toBe('confirme')
    expect(tierOf({ probability: 0.7, nature: 'incident' })).toBe('mobilise')
    expect(tierOf({ probability: 0.4, nature: 'blocage' })).toBe('mobilise')
    expect(tierOf({ probability: 0.1, nature: 'rassemblement' })).toBe('mobilise')
    expect(tierOf({ probability: 0.1, nature: 'incident' })).toBe('mobilise')
    expect(tierOf({ probability: 0.1, nature: 'autre' })).toBe('non-retenu')
    expect(tierOf({ probability: null, nature: null })).toBe('non-juge')
    expect(tierOf({ probability: 0.9, nature: 'blocage', levelConflict: true })).toBe('non-retenu')
    expect(tierOf({ probability: null, nature: null, userReport: true })).toBe('confirme')
  })
  const now = new Date('2026-10-09T10:00:00Z')
  const r = (over: Partial<RapportRow>): RapportRow => ({
    uai: 'A',
    department: '75',
    level: 'lycee',
    status: 'bloque',
    observedAt: '2026-10-09T08:00:00Z',
    domain: 'x.fr',
    tier: 'confirme',
    nature: 'blocage',
    ...over,
  })
  it('chiffres : établissements, pic, départements, facs, sources, en ce moment, natures', () => {
    const rows = [
      r({}),
      r({ uai: 'B', department: '13', level: 'superieur', nature: 'ferme', domain: 'y.fr' }),
      r({ uai: 'C', tier: 'mobilise', nature: 'rassemblement', domain: 'z.fr' }),
      r({ uai: 'A', status: 'leve', observedAt: '2026-10-09T09:00:00Z' }),
      r({ uai: 'D', observedAt: '2026-10-05T08:00:00Z' }),
    ]
    const sure = chiffres(rows, ['confirme'], now)
    expect(sure).toMatchObject({ etablissements: 3, departements: 2, facs: 1, sources: 2 })
    expect(sure.pic).toEqual({ jour: '2026-10-09', n: 2 })
    // A est levé depuis 9 h : il ne compte plus « en ce moment » ; seul B reste.
    expect(sure.maintenant).toEqual({ total: 1, bloques: 1 })
    expect(sure.natures).toEqual({ blocage: 2, ferme: 1 })
    const large = chiffres(rows, ['confirme', 'mobilise'], now)
    expect(large.etablissements).toBe(4)
    expect(large.sources).toBe(3)
  })
})
