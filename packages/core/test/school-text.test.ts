import { describe, expect, test } from 'bun:test'
import {
  eventNamedInText,
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

describe('eventNamedInText', () => {
  const text = "Les élèves du lycée Joséphine-Baker de Périgueux ont bloqué l'entrée ce matin."

  test('a school the article names passes, spelling and accents aside', () => {
    expect(eventNamedInText({ schoolName: 'Lycée Joséphine Baker', city: 'Périgueux' }, text)).toBe(
      true,
    )
    expect(eventNamedInText({ schoolName: 'lycee josephine-baker', city: null }, text)).toBe(true)
  })

  test('a school the article does not mention is refused', () => {
    expect(eventNamedInText({ schoolName: 'Lycée Pasteur', city: 'Lille' }, text)).toBe(false)
    expect(eventNamedInText({ schoolName: 'Université de Nanterre', city: 'Nanterre' }, text)).toBe(
      false,
    )
  })

  test('half of the distinctive words is enough ("Joséphine" alone, a longer cited name)', () => {
    expect(
      eventNamedInText({ schoolName: 'Lycée Joséphine Baker Dordogne', city: null }, text),
    ).toBe(true)
    expect(eventNamedInText({ schoolName: 'Lycée Marie Curie Baker', city: null }, text)).toBe(
      false,
    )
  })

  test('a name made only of the city is checked by the city', () => {
    expect(eventNamedInText({ schoolName: 'lycée de Périgueux', city: 'Périgueux' }, text)).toBe(
      true,
    )
    expect(eventNamedInText({ schoolName: 'lycée de Hanches', city: 'Hanches' }, text)).toBe(false)
  })

  test('an acronym is taken as written', () => {
    expect(
      eventNamedInText({ schoolName: 'ENS Ulm', city: 'Paris' }, "Blocage à l'ENS Ulm ce lundi"),
    ).toBe(true)
  })

  test('nothing checkable passes', () => {
    expect(eventNamedInText({ schoolName: 'Lycée', city: null }, text)).toBe(true)
  })
})
