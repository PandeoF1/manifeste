import { describe, expect, test } from 'bun:test'
import { findAlias, INSTITUTION_ALIASES, isForeignPlace } from '../src/institutions.ts'

describe('findAlias', () => {
  test('answers to the citation whatever its case, accents, apostrophe and entities', () => {
    expect(findAlias('Catho d’Angers', 'Angers')).toBe('0490811R')
    expect(findAlias("CATHO D'ANGERS", 'angers')).toBe('0490811R')
    expect(findAlias('Insp&eacute;', 'Rennes')).toBe('0353074B')
    expect(findAlias('IUT de Saint-J&#233;rome', 'Marseille')).toBe('0131878W')
  })

  test('needs the cited city when the words name something else elsewhere', () => {
    expect(findAlias('Armand', 'Lyon')).toBe('0691644M')
    expect(findAlias('Armand', 'Paris')).toBeNull()
    expect(findAlias('Armand', null)).toBeNull()
    expect(findAlias('la Catho', null)).toBeNull()
  })

  test('an entry without a city answers wherever the citation is', () => {
    expect(findAlias('CentraleSupélec', null)).toBe('0912341A')
    expect(findAlias('CentraleSupélec', 'Metz')).toBe('0912341A')
  })

  test('no two entries claim the same citation for the same city', () => {
    const seen = new Set<string>()
    for (const a of INSTITUTION_ALIASES)
      for (const n of a.names) {
        const key = `${n.toLowerCase()}|${a.city ?? ''}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
  })
})

describe('isForeignPlace', () => {
  test('cities abroad', () => {
    for (const c of ['Liège', 'liege', 'Berlin', 'Hambourg', 'Turin', 'Madrid', 'Montréal'])
      expect(isForeignPlace(c)).toBe(true)
  })

  test('French communes, DOM-TOM and unknown cities are not foreign', () => {
    for (const c of [
      'Lyon',
      'Mayotte',
      'Les Abymes',
      'Valence',
      'Vienne',
      'Mons',
      'Cologne',
      '',
      null,
    ])
      expect(isForeignPlace(c)).toBe(false)
  })
})
