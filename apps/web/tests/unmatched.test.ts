import { describe, expect, it } from 'bun:test'
import { initialQuery } from '@/lib/unmatched'

describe('pre-filled search for manual matching', () => {
  it.each([
    [{ schoolName: 'Lycée Daudet', city: 'Nîmes' }, 'Daudet Nîmes'],
    [{ schoolName: 'Lycée', city: 'Briançon' }, 'Briançon'],
    [{ schoolName: 'lycée professionnel Jean Moulin', city: null }, 'Jean Moulin'],
    [{ schoolName: 'LPO « Les Iris »', city: 'Lormont' }, 'Les Iris Lormont'],
    [{ schoolName: 'Victor-Hugo', city: null }, 'Victor-Hugo'],
  ])('%o -> %s', (u, expected) => {
    expect(initialQuery(u)).toBe(expected)
  })
})
