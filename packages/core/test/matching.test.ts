import { describe, expect, test } from 'bun:test'
import { cleanCitation, isAnnex, pickMatch, type SchoolCandidate } from '../src/matching.ts'

const candidate = (uai: string, name: string, score = 1, extra: Partial<SchoolCandidate> = {}) => ({
  uai,
  name,
  city: 'Toulouse',
  nameScore: score,
  cityScore: 1,
  score,
  ...extra,
})

describe('pickMatch', () => {
  test('the annexes of a school do not make it ambiguous', () => {
    const lycee = candidate('A', 'Lycée polyvalent Rimbaud')
    const annex = candidate('B', "Section d'enseignement professionnel du lycée polyvalent Rimbaud")
    expect(pickMatch([annex, lycee], true, undefined, 'lycée Rimbaud')?.uai).toBe('A')
    expect(isAnnex(annex.name)).toBe(true)
    expect(isAnnex('Micro-lycée Pergaud')).toBe(true)
    expect(isAnnex(lycee.name)).toBe(false)
  })

  test('an annex that scores a little higher still gives way to its school', () => {
    const lycee = candidate('A', "Lycée polyvalent Pierre d'Aragon", 0.9)
    const annex = candidate('B', 'Section d’enseignement professionnel du lycée Pierre Aragon', 1)
    expect(pickMatch([annex, lycee], true, undefined, "lycée Pierre d'Aragon")?.uai).toBe('A')
  })

  test('in a known city, the exact name beats a longer one that contains it', () => {
    const exact = candidate('A', 'Lycée Saint-Charles')
    const longer = candidate('B', 'Lycée Saint-Charles Camas')
    expect(pickMatch([longer, exact], true, undefined, 'Lycée Saint-Charles')?.uai).toBe('A')
    // Without a city the longer name may be the right school of another town: nothing is attached.
    expect(pickMatch([longer, exact], false, undefined, 'Lycée Saint-Charles')).toBeNull()
  })

  test('twins of one site: general first, vocational when the citation says so', () => {
    const site = { lat: 44.45, lng: 1.44 }
    const general = candidate('A', 'Lycée général et technologique Clément Marot', 1, site)
    const vocational = candidate('B', 'Lycée professionnel Clément Marot', 1, site)
    expect(pickMatch([vocational, general], true, undefined, 'lycée Clément Marot')?.uai).toBe('A')
    expect(
      pickMatch([vocational, general], true, undefined, 'lycée professionnel Clément Marot')?.uai,
    ).toBe('B')
  })

  test('namesakes in one city stay unmatched', () => {
    const a = candidate('A', 'Lycée Pasteur', 1, { lat: 43.6, lng: 1.4 })
    const b = candidate('B', 'Lycée privé Pasteur', 1, { lat: 43.7, lng: 1.5 })
    expect(pickMatch([a, b], true, undefined, 'lycée Pasteur')).toBeNull()
  })
})

describe('cleanCitation', () => {
  test('"cité scolaire" is the kind of place, not part of the name', () => {
    expect(cleanCitation('cité scolaire Mistral')).toBe('Mistral')
    expect(cleanCitation('Lycée Jean Moulin')).toBe('Lycée Jean Moulin')
  })
})
