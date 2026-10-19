import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { treaty } from '@elysiajs/eden'
import { createTestDb } from '@manifeste/db/testing'
import { SettingsService } from '../src/modules/settings/service.ts'
import { StatusesService } from '../src/modules/statuses/service.ts'
import { addReport, addSchool } from './seed.ts'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let api: ReturnType<typeof treaty<TestServer['app']>>
const uais = {} as { pasteur: string; curie: string; fac: string; quiet: string }

beforeAll(async () => {
  s = await startTestServer()
  api = treaty(s.app)
  const db = s.ctx.db
  uais.pasteur = await addSchool(db, {
    name: 'Lycée Pasteur',
    city: 'Lille',
    department: '59',
    lat: 50.63,
    lng: 3.06,
  })
  uais.curie = await addSchool(db, {
    name: 'Lycée Marie Curie',
    city: 'Marseille',
    department: '13',
    lat: 43.29,
    lng: 5.37,
  })
  uais.fac = await addSchool(db, {
    name: 'Université de Nanterre',
    city: 'Nanterre',
    department: '92',
    level: 'higher',
    lat: 48.9,
    lng: 2.21,
  })
  uais.quiet = await addSchool(db, {
    name: 'Lycée Calme',
    city: 'Albi',
    department: '81',
    lat: 43.93,
    lng: 2.14,
  })

  await addReport(db, { schoolUai: uais.pasteur, status: 'filtering', hoursAgo: 3 })
  await addReport(db, {
    schoolUai: uais.pasteur,
    status: 'blocked',
    hoursAgo: 1,
    sourceDomain: 'other.org',
  })
  await addReport(db, {
    schoolUai: uais.curie,
    status: 'blocked',
    hoursAgo: 2,
    tier: 'mobilisation',
  })
  await addReport(db, { schoolUai: uais.fac, status: 'lifted', hoursAgo: 4 })
  // Not public: pending, hidden, too old, in the future.
  await addReport(db, { schoolUai: uais.quiet, hoursAgo: 1, moderation: 'pending' })
  await addReport(db, { schoolUai: uais.quiet, hoursAgo: 1, hidden: true })
  await addReport(db, { schoolUai: uais.quiet, hoursAgo: 30 })
  await addReport(db, { schoolUai: uais.quiet, hoursAgo: -3 })
})
afterAll(() => s.close())

describe('settings', () => {
  test('exposes the public subset with defaults, and caches it', async () => {
    // Raw JSON on purpose: Eden Treaty turns date-like strings into Date objects.
    const res = await s.request('/api/settings')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status_ttl_hours: 5,
      movement_start: '2026-09-14',
      judge_tiers: false,
      movements_public: false,
      marches_on_map: false,
      signaled_mobilisations: false,
    })
    expect(res.headers.get('cache-control')).toContain('max-age=60')
  })
})

describe('statuses', () => {
  test('live: the latest report of each school within the TTL, with distinct sources', async () => {
    const { data } = await api.api.statuses.get({ query: { period: 'live' } })
    const byUai = Object.fromEntries((data ?? []).map((r) => [r.uai, r]))
    expect(Object.keys(byUai).sort()).toEqual([uais.curie, uais.fac, uais.pasteur].sort())
    expect(byUai[uais.pasteur]).toMatchObject({
      status: 'blocked',
      sourceCount: 2,
      level: 'secondary',
    })
    expect(byUai[uais.fac]).toMatchObject({ status: 'lifted', level: 'higher' })
    expect(byUai[uais.pasteur]?.lat).toBeCloseTo(50.63, 2)
    // Most recent signal first.
    expect(data?.[0]?.uai).toBe(uais.pasteur)
  })

  test('private reports never show: pending, hidden, expired, future', async () => {
    const { data } = await api.api.statuses.get({ query: { period: 'live' } })
    expect(data?.some((r) => r.uai === uais.quiet)).toBe(false)
  })

  test('a past period keeps the strongest status and counts signal days', async () => {
    const { data } = await api.api.statuses.get({ query: { period: '24h' } })
    const pasteur = data?.find((r) => r.uai === uais.pasteur)
    expect(pasteur).toMatchObject({ status: 'blocked', sourceCount: 2 })
    expect(pasteur?.signalDays).toBeGreaterThanOrEqual(1)
    // The report from 30 h ago is outside 24 h, inside "all".
    expect(
      (await api.api.statuses.get({ query: { period: '24h' } })).data?.some(
        (r) => r.uai === uais.quiet,
      ),
    ).toBe(false)
    expect(
      (await api.api.statuses.get({ query: { period: 'all' } })).data?.some(
        (r) => r.uai === uais.quiet,
      ),
    ).toBe(true)
  })

  test('the judge tiers move mobilisation apart and never count it as blocked', async () => {
    // A dedicated database: the module under test is built on top of it, no timers involved.
    const t = await createTestDb()
    try {
      const settings = new SettingsService(t.db)
      const statuses = new StatusesService(t.db, settings)
      const confirmed = await addSchool(t.db)
      const mobilised = await addSchool(t.db)
      const unjudged = await addSchool(t.db)
      await addReport(t.db, { schoolUai: confirmed, tier: 'confirmed', hoursAgo: 1 })
      await addReport(t.db, { schoolUai: mobilised, tier: 'mobilisation', hoursAgo: 1 })
      await addReport(t.db, { schoolUai: unjudged, tier: 'unjudged', hoursAgo: 1 })

      // Tiers off: every report counts, nothing is "mobilisation".
      expect((await statuses.current('live')).map((r) => r.uai).sort()).toEqual(
        [confirmed, mobilised, unjudged].sort(),
      )
      expect(await statuses.mobilisation('live')).toEqual([])

      await settings.set('judge_tiers', true, null)
      statuses.invalidate()
      expect((await statuses.current('live')).map((r) => r.uai).sort()).toEqual(
        [confirmed, unjudged].sort(),
      )
      expect((await statuses.mobilisation('live')).map((r) => r.uai)).toEqual([mobilised])

      // A school that also has a counted report is not listed as mobilisation only.
      await addReport(t.db, { schoolUai: mobilised, tier: 'confirmed', hoursAgo: 0.5 })
      statuses.invalidate()
      expect(await statuses.mobilisation('live')).toEqual([])
    } finally {
      await t.drop()
    }
  })

  test('an unknown period is rejected', async () => {
    const res = await s.request('/api/statuses?period=forever')
    expect(res.status).toBe(422)
  })
})

describe('schools', () => {
  test('detail of a school, 404 for an unknown or malformed UAI', async () => {
    const ok = await api.api.schools({ uai: uais.pasteur }).get()
    expect(ok.data).toMatchObject({ name: 'Lycée Pasteur', city: 'Lille', level: 'secondary' })
    expect((await api.api.schools({ uai: '9999999Z' }).get()).status).toBe(404)
    expect((await api.api.schools({ uai: 'nope' }).get()).status).toBe(422)
  })

  test('nearby schools, nearest first, within the radius', async () => {
    const { data } = await api.api.schools.nearby.get({
      query: { lat: 50.631, lng: 3.061, radiusM: 2000 },
    })
    expect(data?.map((r) => r.uai)).toEqual([uais.pasteur])
    expect(data?.[0]?.distanceM).toBeLessThan(500)
  })

  test('search ignores case and accents', async () => {
    const { data } = await api.api.schools.search.get({ query: { q: 'lycee pasteur lille' } })
    expect(data?.[0]?.uai).toBe(uais.pasteur)
    expect(
      (await api.api.schools.search.get({ query: { q: 'universite nanterre' } })).data?.[0]?.uai,
    ).toBe(uais.fac)
    expect((await api.api.schools.search.get({ query: { q: 'a' } })).status).toBe(422)
  })

  test('public reports of a school, newest first, without private ones', async () => {
    const { data } = await api.api
      .schools({ uai: uais.pasteur })
      .reports.get({ query: { days: 1 } })
    expect(data?.map((r) => r.status)).toEqual(['blocked', 'filtering'])
    expect(data?.[0]).toMatchObject({ origin: 'press', sourceDomain: 'other.org', photoUrl: null })
    const quiet = await api.api.schools({ uai: uais.quiet }).reports.get({ query: { days: 1 } })
    expect(quiet.data).toEqual([])
    const week = await api.api.schools({ uai: uais.quiet }).reports.get({ query: { days: 7 } })
    expect(week.data).toHaveLength(1)
  })
})

describe('timeline', () => {
  test('every visible report with the schools it mentions, oldest first', async () => {
    const res = await s.request('/api/timeline?period=all')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      schools: Array<{ uai: string; name: string }>
      events: Array<{
        uai: string
        status: string
        at: number
        sourceKey: string
        mobilisation: boolean
      }>
    }
    // Pasteur (2), Curie (1), Nanterre (1) and the 30 h old report of the quiet school: all visible.
    expect(body.events).toHaveLength(5)
    expect(body.schools.map((x) => x.uai).sort()).toEqual(
      [uais.pasteur, uais.curie, uais.fac, uais.quiet].sort(),
    )
    const times = body.events.map((e) => e.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(body.events[0]).toMatchObject({ mobilisation: false })
    expect(body.events.every((e) => e.sourceKey.startsWith('dom:'))).toBe(true)
    // The hidden, pending and future reports of the quiet school never appear.
    expect(body.events.filter((e) => e.uai === uais.quiet)).toHaveLength(1)
  })

  test('a shorter period leaves the older reports out', async () => {
    const res = await s.request('/api/timeline?period=24h')
    const body = (await res.json()) as { events: unknown[] }
    expect(body.events).toHaveLength(4)
  })
})
