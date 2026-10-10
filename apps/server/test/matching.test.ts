import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { isGenericSchoolName, pickByGeo } from '@manifeste/core'
import { createTestDb, type TestDb } from '@manifeste/db/testing'
import { MatchingService } from '../src/modules/schools/matching.ts'
import { addSchool } from './seed.ts'

let t: TestDb
let matching: MatchingService
type Key =
  | 'condorcet'
  | 'condorcetPro'
  | 'pasteur'
  | 'pasteurPrive'
  | 'tolbiac'
  | 'nanterreFac'
  | 'nanterreLycee'
  | 'charlemagne'
const uai = {} as Record<Key, string>

beforeAll(async () => {
  t = await createTestDb()
  matching = new MatchingService(t.db)
  const add = async (key: Key, s: Parameters<typeof addSchool>[1]) =>
    (uai[key] = await addSchool(t.db, s))
  await add('condorcet', { name: 'Lycée Condorcet', city: 'Montreuil', lat: 48.86, lng: 2.44 })
  await add('condorcetPro', {
    name: 'Lycée professionnel Condorcet',
    city: 'Montreuil',
    lat: 48.8601,
    lng: 2.4402,
  })
  await add('pasteur', { name: 'Lycée Pasteur', city: 'Lavalville', lat: 48.9, lng: 2.1 })
  await add('pasteurPrive', {
    name: 'Lycée privé Pasteur',
    city: 'Lavalville',
    lat: 48.91,
    lng: 2.12,
  })
  await add('tolbiac', {
    name: 'Université Paris 1 - Panthéon Sorbonne – Paris 13e (UFR Économie) (Tolbiac)',
    city: 'Paris',
    level: 'higher',
    lat: 48.8264,
    lng: 2.3606,
  })
  await add('nanterreFac', {
    name: 'Université Paris Nanterre',
    city: 'Nanterre',
    level: 'higher',
    lat: 48.9054,
    lng: 2.2127,
  })
  await add('nanterreLycee', { name: 'Lycée Joliot-Curie', city: 'Nanterre', lat: 48.89, lng: 2.2 })
  await add('charlemagne', { name: 'Lycée Charlemagne', city: 'Paris', lat: 48.85, lng: 2.36 })
})
afterAll(() => t.drop())

describe('candidates and match', () => {
  test('twins of one site: the least specific name comes first and is picked', async () => {
    const [first, second] = await matching.candidates('Condorcet', 'Montreuil', 2)
    expect(first?.uai).toBe(uai.condorcet)
    expect(second?.uai).toBe(uai.condorcetPro)
    expect(first?.lat).not.toBeNull()
    expect((await matching.match('lycée Condorcet', 'Montreuil'))?.uai).toBe(uai.condorcet)
  })

  test('distant namesakes are left to a human', async () => {
    expect(await matching.match('lycée Pasteur', 'Lavalville')).toBeNull()
  })

  test('a university site is found by its common name', async () => {
    expect((await matching.match('Fac de Tolbiac', 'Paris'))?.uai).toBe(uai.tolbiac)
    expect((await matching.match('Université de Nanterre', 'Nanterre'))?.uai).toBe(uai.nanterreFac)
  })

  test('a name made only of generic words matches nothing', async () => {
    expect(await matching.candidates('Lycée', 'Paris')).toEqual([])
    expect(isGenericSchoolName('Lycée', 'Briançon')).toBe(true)
  })

  test('accents and case do not matter', async () => {
    expect((await matching.match('LYCEE CHARLEMAGNE', 'paris'))?.uai).toBe(uai.charlemagne)
  })
})

describe('schools of a city', () => {
  test('one lycée and one university in Nanterre, two without a level', async () => {
    expect((await matching.inCity('Nanterre', 5, 'secondary')).map((s) => s.uai)).toEqual([
      uai.nanterreLycee,
    ])
    expect((await matching.inCity('Nanterre', 5, 'higher')).map((s) => s.uai)).toEqual([
      uai.nanterreFac,
    ])
    expect(await matching.inCity('Nanterre', 5)).toHaveLength(2)
    expect(await matching.inCity('', 5)).toEqual([])
  })
})

describe('by position', () => {
  test('attaches a map point to the nearest school with a matching name', async () => {
    const near = await matching.nearbyForGeo(48.8601, 2.4401, 500)
    expect(near.map((n) => n.uai).sort()).toEqual([uai.condorcet, uai.condorcetPro].sort())
    expect(pickByGeo(near, 'Lycée Condorcet')?.uai).toBeDefined()
    expect(await matching.nearbyForGeo(45, 5, 500)).toEqual([])
  })
})
