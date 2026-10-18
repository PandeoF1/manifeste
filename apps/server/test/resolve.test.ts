import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { createTestDb, type TestDb } from '@manifeste/db/testing'
import { MatchingService } from '../src/modules/schools/matching.ts'
import { addSchool } from './seed.ts'

let t: TestDb
let matching: MatchingService
const uai: Record<string, string> = {}
const id = (key: string) => {
  const v = uai[key]
  if (!v) throw new Error(`no school ${key}`)
  return v
}

beforeAll(async () => {
  t = await createTestDb()
  matching = new MatchingService(t.db)
  const add = async (key: string, s: Parameters<typeof addSchool>[1]) =>
    (uai[key] = await addSchool(t.db, s))
  // Lyon and its suburbs (the lat/lng are real enough: Villeurbanne is 4 km from Lyon)
  await add('lyonLycee', { name: 'Lycée Ampère', city: 'Lyon', lat: 45.76, lng: 4.83 })
  await add('brossolette', {
    name: 'Lycée Gilberte et Pierre Brossolette',
    city: 'Villeurbanne',
    lat: 45.77,
    lng: 4.88,
  })
  await add('farBrossolette', {
    name: 'Lycée Pierre Brossolette',
    city: 'Le Kremlin-Bicêtre',
    lat: 48.81,
    lng: 2.36,
  })
  await add('lyon3a', {
    name: 'Université Jean Moulin - Lyon 3 – Lyon 7e',
    city: 'Lyon',
    level: 'higher',
    lat: 45.74,
    lng: 4.84,
  })
  await add('lyon3b', {
    name: 'Université Jean Moulin - Lyon 3 – Lyon 8e',
    city: 'Lyon',
    level: 'higher',
    lat: 45.75,
    lng: 4.87,
  })
  await add('lyonLumiereLycee', {
    name: 'Lycée Auguste et Louis Lumière',
    city: 'Lyon',
    lat: 45.74,
    lng: 4.86,
  })
  await add('lyonLumiereUniv', {
    name: 'Université Lumière - Lyon 2 – Lyon 7e',
    city: 'Lyon',
    level: 'higher',
    lat: 45.75,
    lng: 4.85,
  })
  // Quimper: the school's name has more generic words than the citation
  await add('brizeux', { name: 'Lycée général et technologique Brizeux', city: 'Quimper' })
  // Le Mans: the local university and an outpost of another one
  await add('maine', {
    name: 'Université du Maine – Le Mans',
    city: 'Le Mans',
    level: 'higher',
    lat: 48,
    lng: 0.2,
  })
  await add('maineLaval', {
    name: 'Université du Maine – Laval',
    city: 'Laval',
    level: 'higher',
    lat: 48.07,
    lng: -0.77,
  })
  await add('nantesOutpost', {
    name: 'Université de Nantes – Le Mans',
    city: 'Le Mans',
    level: 'higher',
    lat: 48.01,
    lng: 0.19,
  })
  for (const city of ['Nantes', 'Angers', 'Laval', 'Saint-Nazaire'])
    await add(`nantes${city}`, {
      name: `Université de Nantes – ${city}`,
      city,
      level: 'higher',
      lat: 47.2,
      lng: -1.5,
    })
  // Alias
  await add('hec', {
    name: 'École des hautes études commerciales de Paris',
    city: 'Jouy-en-Josas',
    level: 'higher',
    aliases: ['HEC'],
  })
  await add('ecoleA', { name: 'Lycée privé Ecole A', city: 'Paris' })
  await add('angers', { name: "Université d'Angers – Angers", city: 'Angers', level: 'higher' })
  await add('balzacParis', { name: 'Lycée Balzac', city: 'Paris', lat: 48.89, lng: 2.32 })
  await add('balzacTours', { name: 'Lycée Balzac', city: 'Tours', lat: 47.39, lng: 0.69 })
})
afterAll(() => t.drop())

describe('resolve', () => {
  test('entities left by the scraper are decoded, in the name and in the city', async () => {
    const r = await matching.resolve('Lyc&eacute;e Brizeux', 'Quimper')
    expect(r).toEqual({ uai: id('brizeux'), via: 'name' })
    expect((await matching.resolve('Brizeux', 'Qu&#105;mper'))?.uai).toBe(id('brizeux'))
  })

  test('a citation with an extra word still finds the school ("Auguste-Brizeux")', async () => {
    expect((await matching.resolve('lycée public Auguste-Brizeux', 'Quimper'))?.uai).toBe(
      id('brizeux'),
    )
  })

  test('a school in a neighbouring town, never one in another region', async () => {
    const r = await matching.resolve('Brossolette', 'Lyon')
    expect(r).toEqual({ uai: id('brossolette'), via: 'nearby' })
  })

  test('the sites of one university are one school; the first one is used', async () => {
    const r = await matching.resolve('université Lyon 3', 'Lyon')
    expect([id('lyon3a'), id('lyon3b')]).toContain(r?.uai ?? '')
  })

  test('a bare name is the lycée, the university needs a word of it', async () => {
    expect((await matching.resolve('Lumière', 'Lyon'))?.uai).toBe(id('lyonLumiereLycee'))
  })

  test('"fac de droit" in a city is its local university, not the outpost of another one', async () => {
    const r = await matching.resolve('fac de droit', 'Le Mans')
    expect(r).toEqual({ uai: id('maine'), via: 'university' })
  })

  test('a part of a university names no other school of the region', async () => {
    expect(await matching.resolve('fac de droit', 'Lyon')).toMatchObject({ via: 'university' })
    // "droit" is no school name: nothing is found by position either
    expect(await matching.nearby('fac de droit', 'Lyon')).toBeNull()
  })

  test('an alias names the school, with or without the city', async () => {
    expect(await matching.resolve('HEC', null)).toEqual({ uai: id('hec'), via: 'name' })
    expect((await matching.resolve('HEC', 'Jouy-en-Josas'))?.uai).toBe(id('hec'))
  })

  test('a name that is only a kind of place does not pick a school ("École de commerce")', async () => {
    expect(await matching.resolve('École de commerce', 'Paris')).toBeNull()
    expect(await matching.nearby('École de commerce HEC', 'Jouy-en-Josas')).toBeNull()
  })

  test('the city alone never makes a university the answer ("Catho d\'Angers")', async () => {
    // The curated alias points at the Facultés libres de l'Ouest, which this directory lacks.
    expect(await matching.resolve("Catho d'Angers", 'Angers')).toBeNull()
  })

  test('two lycées of that name and no city: the city the article mentions decides', async () => {
    expect(await matching.resolve('Balzac', null)).toBeNull()
    expect((await matching.resolve('Balzac', null, 'Blocus au lycée de Tours'))?.uai).toBe(
      id('balzacTours'),
    )
    expect(await matching.resolve('Balzac', null, 'Blocus à Tours et à Paris')).toBeNull()
  })
})

describe('memory of staff links', () => {
  const link = (schoolName: string, city: string | null, linkedUai: string, n = 1) =>
    t.db.insert(schema.unmatched).values(
      Array.from({ length: n }, () => ({
        schoolName,
        city,
        status: 'blocked' as const,
        sourceUrl: 'https://example.org/a',
        observedAt: new Date(),
        resolvedAt: new Date(),
        resolution: 'linked',
        linkedUai,
      })),
    )

  test('the same name and city are linked the same way', async () => {
    await link('Armand', 'Lyon', id('lyonLycee')) // a link that does not look like the name
    expect(await matching.memory('Armand', 'Lyon')).toBeNull()
    await link('Ampère', 'Lyon', id('lyonLycee'))
    expect(await matching.memory('lycée Ampère', 'Lyon')).toBe(id('lyonLycee'))
    expect((await matching.resolve('Ampère', 'Lyon'))?.via).toBe('memory')
  })

  test('two schools linked for one name: nothing is remembered', async () => {
    await link('Balzac', 'Nowhere', id('balzacParis'))
    await link('Balzac', 'Nowhere', id('balzacTours'))
    expect(await matching.memory('Balzac', 'Nowhere')).toBeNull()
  })

  test('without a city, it takes three agreeing links', async () => {
    await link('cité scolaire Cuvier', 'Paris', id('balzacParis'), 2)
    expect(await matching.memory('Cuvier', null)).toBeNull()
  })
})
