import { describe, expect, test } from 'bun:test'
import {
  cleanCitation,
  institutionKey,
  isAnnex,
  isGenericSchoolName,
  isPartOfUniversity,
  pickMatch,
  type SchoolCandidate,
} from '../src/matching.ts'

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

describe('cleanCitation', () => {
  test('decodes HTML entities left by the scraper', () => {
    expect(cleanCitation('Lyc&eacute;e D&eacute;odat-de-S&eacute;verac')).toBe(
      'Lycée Déodat-de-Séverac',
    )
    expect(cleanCitation('IUT de Saint-J&#233;rome')).toBe('IUT de Saint-Jérome')
    expect(cleanCitation('R&amp;D &unknown;')).toBe('R&D &unknown;')
  })

  test('drops the kind of place', () => {
    expect(cleanCitation('groupe scolaire La Pérouse-Kerichen')).toBe('La Pérouse-Kerichen')
    expect(cleanCitation('institution Sacré-Cœur')).toBe('Sacré-Cœur')
  })
})

describe('pickMatch and the sites of one university', () => {
  const site = (uai: string, name: string) =>
    candidate(uai, name, 1, { level: 'higher', city: 'Lyon' })

  test('two sites of one university are not rivals', () => {
    const sites = [
      site('A', 'Université Jean Moulin - Lyon 3 – Lyon 7e'),
      site('B', 'Université Jean Moulin - Lyon 3 – Lyon 8e'),
    ]
    expect(institutionKey('Université Jean Moulin - Lyon 3 – Lyon 7e')).toBe(
      institutionKey('Université Jean Moulin - Lyon 3 – Lyon 8e'),
    )
    expect(pickMatch(sites, true, undefined, 'Lyon 3')?.uai).toBe('A')
  })

  test('two universities are rivals', () => {
    const rivals = [
      site('A', 'Université Lyon 1 – Lyon 7e'),
      site('B', 'Université Lyon 2 – Lyon 7e'),
    ]
    expect(pickMatch(rivals, true, undefined, 'université de Lyon')).toBeNull()
  })

  test('a bare name is a lycée, "fac" is higher education', () => {
    const lycee = candidate('L', 'Lycée Lumière', 1, { level: 'secondary', city: 'Lyon' })
    const univ = candidate('U', 'Université Lumière - Lyon 2', 1, { level: 'higher', city: 'Lyon' })
    expect(pickMatch([univ, lycee], true, undefined, 'Lumière')?.uai).toBe('L')
    expect(pickMatch([univ, lycee], true, undefined, 'fac Lumière')?.uai).toBe('U')
  })
})

describe('pickMatch and a misspelt name', () => {
  const malherbe = candidate('M', 'Lycée François de Malherbe', 0.58, {
    nameScore: 0.58,
    score: 0.55,
    city: 'Caen',
  })
  const other = candidate('S', 'Lycée Sainte-Marie', 0.3, {
    nameScore: 0.3,
    score: 0.5,
    city: 'Caen',
  })

  test('a word one letter away, in the exact city, with no other close school', () => {
    expect(pickMatch([malherbe, other], true, undefined, 'Marlherbe')?.uai).toBe('M')
  })

  test('not when no word of the citation looks like the name', () => {
    const univ = candidate('U', "Université d'Angers – Angers", 0.54, {
      nameScore: 0.54,
      score: 0.55,
      city: 'Angers',
    })
    expect(pickMatch([univ], true, undefined, "Catho d'Angers")).toBeNull()
  })
})

describe('isGenericSchoolName', () => {
  test('a kind of school and a town name no school', () => {
    expect(
      isGenericSchoolName('lycée agricole de Saint-Aubin-du-Cormier', 'Saint-Aubin-du-Cormier'),
    ).toBe(true)
    expect(isGenericSchoolName('lycée agricole', null)).toBe(true)
    expect(isGenericSchoolName('lycée Brizeux', 'Quimper')).toBe(false)
  })
})

describe('isPartOfUniversity', () => {
  test('a faculty, an IUT or a campus is a part of a university', () => {
    for (const n of [
      'fac de droit',
      'IUT',
      'campus de la Fonderie',
      'pôle universitaire Jules-Verne',
    ])
      expect(isPartOfUniversity(n)).toBe(true)
    expect(isPartOfUniversity('lycée Condorcet')).toBe(false)
    expect(isPartOfUniversity('Lyon 3')).toBe(false)
  })
})
