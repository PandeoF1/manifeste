import { describe, expect, test } from 'bun:test'
import {
  matchSchool,
  mentionsSchool,
  norm,
  sameSchool,
  sentencesAbout,
} from '../src/school-text.ts'

describe('sameSchool', () => {
  const school = { name: 'Lycée polyvalent Jules Guesde', city: 'Montpellier' }

  test('recognises the distinctive name despite punctuation and accents', () => {
    expect(sameSchool({ schoolName: 'lycée Jules-Guesde', city: 'Montpellier' }, school)).toBe(true)
  })

  test('rejects another school', () => {
    expect(sameSchool({ schoolName: 'lycée Arago', city: 'Paris' }, school)).toBe(false)
  })

  test('without a distinctive name, compares the city', () => {
    const generic = { name: 'Lycée général', city: 'Lille' }
    expect(sameSchool({ schoolName: 'le lycée', city: 'Lille' }, generic)).toBe(true)
    expect(sameSchool({ schoolName: 'le lycée', city: 'Lyon' }, generic)).toBe(false)
  })
})

describe('matchSchool', () => {
  test('acronym: ENS for École normale supérieure', () => {
    const ens = { name: 'École normale supérieure', city: 'Paris' }
    expect(matchSchool({ schoolName: 'ENS Ulm', city: 'Paris' }, ens)).toBe('yes')
  })

  test('a university named by its city', () => {
    const nantes = { name: 'Université de Nantes', city: 'Nantes' }
    expect(matchSchool({ schoolName: 'campus Censive', city: 'Nantes' }, nantes)).toBe('yes')
    expect(matchSchool({ schoolName: 'campus Censive', city: 'Rennes' }, nantes)).toBe('no')
  })

  test('same city, name not recognised: to check by hand', () => {
    const lycee = { name: 'Lycée Maupertuis', city: 'Saint-Malo' }
    expect(matchSchool({ schoolName: 'lycée de Saint-Malo', city: 'Saint-Malo' }, lycee)).toBe(
      'city',
    )
    expect(matchSchool({ schoolName: 'lycée Jean Moulin', city: 'Lyon' }, lycee)).toBe('no')
  })
})

describe('mentions in a text', () => {
  test('sentencesAbout keeps the sentences about the school', () => {
    const text = 'Il pleut. Le lycée Mounier est bloqué. Autre sujet.'
    expect(sentencesAbout(text, { name: 'Lycée Mounier', city: 'Grenoble' })).toEqual([
      'Le lycée Mounier est bloqué.',
    ])
  })

  test('a city alone counts as a mention, a generic word does not', () => {
    const school = { name: 'Lycée polyvalent Mounier', city: 'Grenoble' }
    expect(mentionsSchool('Blocage à Grenoble ce mardi', school)).toBe(true)
    expect(mentionsSchool('Blocage du lycée polyvalent ce mardi', school)).toBe(false)
    expect(mentionsSchool('Blocage à Rennes ce mardi', school)).toBe(false)
  })

  test('strict mode ignores the city when the name has a distinctive word', () => {
    const school = { name: 'Lycée Charlemagne', city: 'Paris' }
    expect(mentionsSchool('Mobilisation à Paris ce mardi', school)).toBe(true)
    expect(mentionsSchool('Mobilisation à Paris ce mardi', school, { strict: true })).toBe(false)
    expect(mentionsSchool('Le lycée Charlemagne est bloqué', school, { strict: true })).toBe(true)
    // No distinctive word in the name: the city is all there is.
    const nantes = { name: 'Université de Nantes', city: 'Nantes' }
    expect(mentionsSchool('Blocus à Nantes', nantes, { strict: true })).toBe(true)
  })

  test('norm strips accents and case', () => {
    expect(norm('Lycée Évariste-Galois')).toBe('lycee evariste-galois')
    expect(norm(null)).toBe('')
  })
})
