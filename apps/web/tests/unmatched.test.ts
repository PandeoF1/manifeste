import { describe, expect, it } from 'bun:test'
import { initialQuery } from '@/lib/unmatched'

describe('pre-filled search for manual matching', () => {
  it.each([
    [{ school_name: 'Lycée Daudet', city: 'Nîmes' }, 'Daudet Nîmes'],
    [{ school_name: 'Lycée', city: 'Briançon' }, 'Briançon'],
    [{ school_name: 'lycée professionnel Jean Moulin', city: null }, 'Jean Moulin'],
    [{ school_name: 'LPO « Les Iris »', city: 'Lormont' }, 'Les Iris Lormont'],
    [{ school_name: 'Victor-Hugo', city: null }, 'Victor-Hugo'],
  ])('%o -> %s', (u, expected) => {
    expect(initialQuery(u)).toBe(expected)
  })
})
