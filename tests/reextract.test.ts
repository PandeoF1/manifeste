import { describe, expect, it } from 'vitest'
import { cleanReadable } from '@shared/page.ts'
import { sameSchool } from '@shared/school-text.ts'

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
