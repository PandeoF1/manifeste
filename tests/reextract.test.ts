import { describe, expect, it } from 'vitest'
import { cleanReadable } from '@shared/page.ts'
import { matchSchool, sameSchool } from '@shared/school-text.ts'

describe('sameSchool', () => {
  const school = { name: 'Lycée polyvalent Jules Guesde', city: 'Montpellier' }
  it('reconnaît le nom distinctif malgré la ponctuation et les accents', () => {
    expect(sameSchool({ school_name: 'lycée Jules-Guesde', city: 'Montpellier' }, school)).toBe(
      true,
    )
  })
  it('rejette un autre établissement', () => {
    expect(sameSchool({ school_name: 'lycée Arago', city: 'Paris' }, school)).toBe(false)
  })
  it('à défaut de nom distinctif, compare la commune', () => {
    const generic = { name: 'Lycée général', city: 'Lille' }
    expect(sameSchool({ school_name: 'le lycée', city: 'Lille' }, generic)).toBe(true)
    expect(sameSchool({ school_name: 'le lycée', city: 'Lyon' }, generic)).toBe(false)
  })
})

describe('matchSchool', () => {
  it('sigle : ENS pour École normale supérieure', () => {
    const ens = { name: 'École normale supérieure', city: 'Paris' }
    expect(matchSchool({ school_name: 'ENS Ulm', city: 'Paris' }, ens)).toBe('oui')
  })
  it('université nommée par sa commune', () => {
    const nantes = { name: 'Université de Nantes', city: 'Nantes' }
    expect(matchSchool({ school_name: 'campus Censive', city: 'Nantes' }, nantes)).toBe('oui')
    expect(matchSchool({ school_name: 'campus Censive', city: 'Rennes' }, nantes)).toBe('non')
  })
  it('même commune, nom non reconnu : à voir à la main', () => {
    const lycee = { name: 'Lycée Maupertuis', city: 'Saint-Malo' }
    expect(matchSchool({ school_name: 'lycée de Saint-Malo', city: 'Saint-Malo' }, lycee)).toBe(
      'ville',
    )
    expect(matchSchool({ school_name: 'lycée Jean Moulin', city: 'Lyon' }, lycee)).toBe('non')
  })
})

describe('cleanReadable', () => {
  it('retire menus courts et bandeau de cookies, garde les paragraphes', () => {
    const text = [
      'FRANCE',
      'EUROPE',
      'Nous et nos partenaires utilisons des cookies ou technologies similaires pour accéder à des informations.',
      'Le lycée Jules-Guesde de Montpellier est bloqué depuis ce matin par des élèves mobilisés.',
    ].join('\n')
    expect(cleanReadable(text)).toBe(
      'Le lycée Jules-Guesde de Montpellier est bloqué depuis ce matin par des élèves mobilisés.',
    )
  })
})
