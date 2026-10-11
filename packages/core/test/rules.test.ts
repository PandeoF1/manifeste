import { describe, expect, test } from 'bun:test'
import {
  canonicalUrl,
  extractDomain,
  isGenericSchoolName,
  isRelevant,
  isStatusExpired,
  isTrustedDomain,
  levelOfName,
  meetsCertainty,
  normalizeDomainInput,
  pickByGeo,
  pickMatch,
  roundCoord,
  stripGenericWords,
  type SchoolCandidate,
} from '../src/index.ts'

describe('relevance filter', () => {
  test('keeps relevant messages', () => {
    for (const text of [
      'Blocus au lycée Victor-Hugo',
      'Barrage filtrant devant le LP',
      'Blocus de la fac de Tolbiac par les étudiants',
      'La mobilisation étudiante gagne Nanterre',
      'Pays de la Loire : le blocage de la cité scolaire de Saint-Nazaire tendu',
      'Blocage de Sciences Po : des gaz lacrymogènes utilisés pour disperser les étudiants',
      'Colère des lycéens à Montpellier : la préfète interdit les rassemblements',
      'Blocage de la fac de droit de Strasbourg',
      'Lycée Victor-Hugo',
      'Le LGT est fermé',
      'Piquet de grève devant le lycée',
      'Mobilisation lycéenne : point sur la situation',
      'Il est bloqué ce matin',
    ]) {
      expect(isRelevant(text)).toBe(true)
    }
  })

  test('drops off-topic messages', () => {
    for (const text of [
      'Concert ce soir',
      'Résultats du baccalauréat : la liste des admis',
      'Grève des contrôleurs aériens ce week-end',
      'Une école de Rennes fête ses 100 ans',
    ]) {
      expect(isRelevant(text)).toBe(false)
    }
  })
})

describe('certainty', () => {
  test('compares levels', () => {
    expect(meetsCertainty('high', 'medium')).toBe(true)
    expect(meetsCertainty('medium', 'medium')).toBe(true)
    expect(meetsCertainty('low', 'medium')).toBe(false)
  })
})

describe('domains', () => {
  test.each([
    ['https://www.lemonde.fr/societe/article/x.html', 'lemonde.fr'],
    ['https://m.facebook.com/x', 'facebook.com'],
    ['https://Actu.FR/bretagne', 'actu.fr'],
    ['https://t.me/canal/12', 't.me'],
    ['https://amp.leparisien.fr/x', 'leparisien.fr'],
  ])('%s -> %s', (url, expected) => {
    expect(extractDomain(url)).toBe(expected)
  })

  test.each(['http://lemonde.fr', 'pas une url', 'https://localhost/x', 'javascript:alert(1)'])(
    'refuses %s',
    (url) => {
      expect(extractDomain(url)).toBeNull()
    },
  )

  test('normalises a typed domain', () => {
    expect(normalizeDomainInput(' www.Ouest-France.fr/ ')).toBe('ouest-france.fr')
    expect(normalizeDomainInput('http://sudouest.fr')).toBe('sudouest.fr')
    expect(normalizeDomainInput('')).toBeNull()
  })

  test('canonical URLs drop tracking and fragments', () => {
    expect(canonicalUrl('https://a.fr/x/?utm_source=rss&id=3#top')).toBe('https://a.fr/x/?id=3')
    expect(canonicalUrl('https://a.fr/article/?at_medium=lien_RSS')).toBe('https://a.fr/article')
    expect(canonicalUrl('not a url')).toBe('not a url')
  })

  test('trusted domains cover their subdomains', () => {
    expect(isTrustedDomain('france3-regions.francetvinfo.fr', ['francetvinfo.fr'])).toBe(true)
    expect(isTrustedDomain('notfrancetvinfo.fr', ['francetvinfo.fr'])).toBe(false)
    expect(isTrustedDomain(null, ['francetvinfo.fr'])).toBe(false)
  })
})

describe('status expiry', () => {
  const now = new Date('2026-10-04T12:00:00Z')
  test('active before the TTL, expired at it', () => {
    expect(isStatusExpired(new Date('2026-10-04T07:01:00Z'), now)).toBe(false)
    expect(isStatusExpired(new Date('2026-10-04T07:00:00Z'), now)).toBe(true)
    expect(isStatusExpired(new Date('2026-10-04T10:30:00Z'), now, 1)).toBe(true)
  })
})

describe('pickMatch', () => {
  const c = (uai: string, nameScore: number, cityScore: number): SchoolCandidate => ({
    uai,
    name: 'n',
    city: 'c',
    nameScore,
    cityScore,
    score: 0.65 * nameScore + 0.35 * cityScore,
  })

  test('the city picks the right namesake', () => {
    expect(pickMatch([c('B', 1, 1), c('A', 1, 0)], true)?.uai).toBe('B')
  })

  test('keeps the twin of one site, refuses a distant namesake', () => {
    const twin = (uai: string, name: string, lng: number): SchoolCandidate => ({
      uai,
      name,
      city: 'Montreuil',
      nameScore: 1,
      cityScore: 1,
      score: 1,
      lat: 48.86,
      lng,
    })
    const general = twin('G', 'Lycée Condorcet', 2.44)
    const pro = twin('P', 'Lycée professionnel Condorcet', 2.4402)
    expect(pickMatch([pro, general], true)?.uai).toBe('G')
    expect(pickMatch([general, twin('F', 'Lycée privé Condorcet', 2.5)], true)).toBeNull()
  })

  test('refuses namesakes without a city, accepts a unique exact name', () => {
    expect(pickMatch([c('A', 1, 0), c('B', 1, 0)], false)).toBeNull()
    expect(pickMatch([c('A', 1, 0), c('B', 0.4, 0)], false)?.uai).toBe('A')
  })

  test('refuses an inconsistent city, a distant name, no candidate', () => {
    expect(pickMatch([c('A', 1, 0.2)], true)).toBeNull()
    expect(pickMatch([c('A', 0.5, 1)], true)).toBeNull()
    expect(pickMatch([], true)).toBeNull()
  })
})

describe('school names', () => {
  test('generic words are stripped', () => {
    expect(stripGenericWords('Lycée professionnel Jean-Moulin')).toBe('jean moulin')
    expect(isGenericSchoolName('Lycée de Hanches', 'Hanches')).toBe(true)
    expect(isGenericSchoolName('Université', null)).toBe(true)
    expect(isGenericSchoolName('Lycée Condorcet', 'Montreuil')).toBe(false)
  })

  test('level from the cited name', () => {
    expect(levelOfName('Université de Nanterre')).toBe('higher')
    expect(levelOfName('fac de Tolbiac')).toBe('higher')
    expect(levelOfName('Sciences Po Paris')).toBe('higher')
    expect(levelOfName('Lycée Victor-Hugo')).toBe('secondary')
    expect(levelOfName('Cité scolaire Jean-Jaurès')).toBe('secondary')
  })

  test('geographic attach: shared words first, else the only school within 250 m', () => {
    const near = [
      { uai: 'A', name: 'Lycée Pasteur', distanceM: 600 },
      { uai: 'B', name: 'Lycée Faidherbe', distanceM: 120 },
    ]
    expect(pickByGeo(near, 'Lycée Pasteur')?.uai).toBe('A')
    expect(pickByGeo(near, 'Lycée inconnu')?.uai).toBe('B')
    expect(pickByGeo([...near, { uai: 'C', name: 'LP Baggio', distanceM: 200 }], 'x')).toBeNull()
  })
})

describe('positions', () => {
  test('rounded to about 100 m', () => {
    expect(roundCoord(48.856613)).toBe(48.857)
    expect(roundCoord(-2.35222)).toBe(-2.352)
  })
})
