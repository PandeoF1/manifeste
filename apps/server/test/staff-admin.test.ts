import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { newBlobKey } from '../src/storage/blob-store.ts'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'
import { addSchool } from './seed.ts'

let s: TestServer
let admin: { cookie: string }
let moderator: { cookie: string }
let lille: string

beforeAll(async () => {
  s = await startTestServer()
  admin = { cookie: await signInStaff(s, 'admin@example.org', 'admin') }
  moderator = { cookie: await signInStaff(s, 'mod@example.org', 'moderator') }
  lille = await addSchool(s.ctx.db, {
    name: 'Lycée Pasteur',
    city: 'Lille',
    department: '59',
    academy: 'Lille',
    lat: 50.63,
    lng: 3.06,
  })
})
afterAll(() => s.close())

const visitorless = () => ({ cookie: '' })
const as = (who: { cookie: string }, path: string, init: RequestInit & { json?: unknown } = {}) =>
  s.request(path, { ...init, headers: { ...(init.headers as object), cookie: who.cookie } })

describe('unmatched queue', () => {
  async function waiting(over: Partial<typeof schema.unmatched.$inferInsert> = {}) {
    const [src] = await s.ctx.db
      .insert(schema.sources)
      .values({
        kind: 'rss',
        identifier: `https://${crypto.randomUUID()}.example/feed`,
        label: 'U',
        origin: 'press',
      })
      .returning({ id: schema.sources.id })
    const [row] = await s.ctx.db
      .insert(schema.unmatched)
      .values({
        sourceId: src?.id ?? null,
        sourceDomain: 'u.example',
        schoolName: 'Lycée Inconnu',
        city: 'Lille',
        status: 'blocked',
        sourceUrl: `https://u.example/${crypto.randomUUID()}`,
        observedAt: new Date(),
        context: 'excerpt',
        ...over,
      })
      .returning({ id: schema.unmatched.id })
    return row?.id ?? ''
  }

  test('moderators work the queue; visitors cannot', async () => {
    expect((await s.request('/api/staff/unmatched')).status).toBe(401)
    const id = await waiting()
    const list = (await (await as(moderator, '/api/staff/unmatched')).json()) as Array<{
      id: string
    }>
    expect(list.some((r) => r.id === id)).toBe(true)
    const cands = (await (
      await as(moderator, `/api/staff/unmatched/${id}/candidates`)
    ).json()) as Array<{ uai: string }>
    expect(cands.map((c) => c.uai)).toContain(lille)
  })

  test('link: without an extraction the row carries what the report needs; a second link is refused', async () => {
    const id = await waiting()
    const res = await as(moderator, `/api/staff/unmatched/${id}/link`, {
      method: 'POST',
      json: { uai: lille },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ outcome: 'reported' })
    const [report] = await s.ctx.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.schoolUai, lille))
    expect(report).toMatchObject({
      origin: 'press',
      moderation: 'pending',
      sourceDomain: 'u.example',
    })
    const [row] = await s.ctx.db.select().from(schema.unmatched).where(eq(schema.unmatched.id, id))
    expect(row).toMatchObject({ resolution: 'linked', linkedUai: lille })
    expect(
      (
        await as(moderator, `/api/staff/unmatched/${id}/link`, {
          method: 'POST',
          json: { uai: lille },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await as(moderator, `/api/staff/unmatched/${await waiting()}/link`, {
          method: 'POST',
          json: { uai: '0000000Z' },
        })
      ).status,
    ).toBe(422)
  })

  test('dismiss drops the row and its excerpt', async () => {
    const id = await waiting()
    expect(
      (await as(moderator, `/api/staff/unmatched/${id}/dismiss`, { method: 'POST' })).status,
    ).toBe(200)
    const [row] = await s.ctx.db.select().from(schema.unmatched).where(eq(schema.unmatched.id, id))
    expect(row).toMatchObject({ resolution: 'dismissed', context: null })
    expect(
      (await as(moderator, `/api/staff/unmatched/${id}/dismiss`, { method: 'POST' })).status,
    ).toBe(404)
  })
})

describe('trusted domains', () => {
  test('admins manage them; the input is normalised', async () => {
    expect((await as(moderator, '/api/staff/trusted-domains')).status).toBe(403)
    const add = await as(admin, '/api/staff/trusted-domains', {
      method: 'POST',
      json: { domain: 'https://www.Le-Journal.fr/', label: 'Le Journal', origin: 'press' },
    })
    expect(await add.json()).toMatchObject({ domain: 'le-journal.fr', origin: 'press' })
    expect(
      (
        await as(admin, '/api/staff/trusted-domains', {
          method: 'POST',
          json: { domain: 'le-journal.fr', label: 'x', origin: 'press' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await as(admin, '/api/staff/trusted-domains', {
          method: 'POST',
          json: { domain: 'localhost', label: 'x', origin: 'press' },
        })
      ).status,
    ).toBe(422)
    const list = (await (await as(admin, '/api/staff/trusted-domains')).json()) as Array<{
      domain: string
    }>
    expect(list.map((d) => d.domain)).toContain('le-journal.fr')
    expect(
      (await as(admin, '/api/staff/trusted-domains/le-journal.fr', { method: 'DELETE' })).status,
    ).toBe(204)
    expect(
      (await as(admin, '/api/staff/trusted-domains/le-journal.fr', { method: 'DELETE' })).status,
    ).toBe(404)
  })
})

describe('settings', () => {
  test('values come with their default; changes are validated, audited and reversible', async () => {
    expect((await as(moderator, '/api/staff/settings')).status).toBe(403)
    const all = (await (await as(admin, '/api/staff/settings')).json()) as Array<{
      key: string
      value: unknown
      isDefault: boolean
    }>
    expect(all.find((x) => x.key === 'status_ttl_hours')).toMatchObject({
      value: 5,
      isDefault: true,
    })
    expect(
      (
        await as(admin, '/api/staff/settings/status_ttl_hours', {
          method: 'PUT',
          json: { value: 999 },
        })
      ).status,
    ).toBe(422)
    expect(
      (await as(admin, '/api/staff/settings/nope', { method: 'PUT', json: { value: 1 } })).status,
    ).toBe(404)
    expect(
      (
        await as(admin, '/api/staff/settings/status_ttl_hours', {
          method: 'PUT',
          json: { value: 8 },
        })
      ).status,
    ).toBe(200)
    expect(await (await s.request('/api/settings')).json()).toMatchObject({ status_ttl_hours: 8 })
    expect(
      (await as(admin, '/api/staff/settings/status_ttl_hours', { method: 'DELETE' })).status,
    ).toBe(200)
    expect(await (await s.request('/api/settings')).json()).toMatchObject({ status_ttl_hours: 5 })
    const audit = (await (
      await as(admin, '/api/staff/audit?action=settings.set')
    ).json()) as Array<{ before: unknown; after: unknown; actorEmail: string }>
    expect(audit[0]).toMatchObject({ before: 5, after: 8, actorEmail: 'admin@example.org' })
  })
})

describe('audit', () => {
  test('newest first, pageable, admins only', async () => {
    expect((await as(moderator, '/api/staff/audit')).status).toBe(403)
    const page1 = (await (await as(admin, '/api/staff/audit?limit=2')).json()) as Array<{
      id: number
    }>
    expect(page1).toHaveLength(2)
    expect(page1[0]?.id ?? 0).toBeGreaterThan(page1[1]?.id ?? 0)
    const page2 = (await (
      await as(admin, `/api/staff/audit?limit=2&before=${page1[1]?.id ?? 0}`)
    ).json()) as Array<{ id: number }>
    expect(page2.every((l) => l.id < (page1[1]?.id ?? 0))).toBe(true)
  })
})

describe('proposals', () => {
  async function proposal() {
    const photoKey = newBlobKey('private', 'jpeg')
    await s.blobs.put(photoKey, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
    const [p] = await s.ctx.db
      .insert(schema.schoolProposals)
      .values({
        name: 'Lycée Neuf',
        city: 'Lille',
        status: 'blocked',
        lat: 50.631,
        lng: 3.061,
        photoKey,
        sourceUrl: 'https://www.press.example/x',
      })
      .returning({ id: schema.schoolProposals.id })
    return { id: p?.id ?? '', photoKey }
  }

  test('the list offers nearby schools as candidates', async () => {
    const { id } = await proposal()
    const list = (await (await as(moderator, '/api/staff/proposals')).json()) as Array<{
      id: string
      hasPhoto: boolean
      candidates: Array<{ uai: string }>
    }>
    const mine = list.find((p) => p.id === id)
    expect(mine?.hasPhoto).toBe(true)
    expect(mine?.candidates.map((c) => c.uai)).toContain(lille)
    expect(
      (await as(moderator, `/api/staff/proposals/${id}/photo`)).headers.get('cache-control'),
    ).toBe('private, no-store')
  })

  test('link to an existing school: a pending on-site report, the photo follows, the proposal is gone', async () => {
    const { id, photoKey } = await proposal()
    const res = await as(moderator, `/api/staff/proposals/${id}/resolve`, {
      method: 'POST',
      json: { linkUai: lille },
    })
    expect(res.status).toBe(200)
    const { reportId } = (await res.json()) as { reportId: string }
    const [report] = await s.ctx.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
    expect(report).toMatchObject({
      schoolUai: lille,
      origin: 'on_site',
      moderation: 'pending',
      tier: 'confirmed',
      sourceDomain: 'press.example',
    })
    const [sub] = await s.ctx.db
      .select()
      .from(schema.reportSubmissions)
      .where(eq(schema.reportSubmissions.reportId, reportId))
    expect(sub).toMatchObject({ photoKey })
    expect(
      await s.ctx.db.select().from(schema.schoolProposals).where(eq(schema.schoolProposals.id, id)),
    ).toHaveLength(0)
  })

  test('create the school: a 999 UAI, department and academy from the nearest school; or the real UAI', async () => {
    const a = await proposal()
    const created = (await (
      await as(admin, `/api/staff/proposals/${a.id}/resolve`, {
        method: 'POST',
        json: { name: 'Lycée Neuf de Lille', city: 'Lille' },
      })
    ).json()) as { uai: string }
    expect(created.uai).toMatch(/^999\d{4}Z$/)
    const [school] = await s.ctx.db
      .select()
      .from(schema.schools)
      .where(eq(schema.schools.uai, created.uai))
    expect(school).toMatchObject({
      name: 'Lycée Neuf de Lille',
      department: '59',
      academy: 'Lille',
      kind: 'added',
    })
    const b = await proposal()
    const real = (await (
      await as(admin, `/api/staff/proposals/${b.id}/resolve`, {
        method: 'POST',
        json: { newUai: '0591234A' },
      })
    ).json()) as { uai: string }
    expect(real.uai).toBe('0591234A')
    const c = await proposal()
    expect(
      (
        await as(admin, `/api/staff/proposals/${c.id}/resolve`, {
          method: 'POST',
          json: { newUai: '0591234A' },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await as(admin, `/api/staff/proposals/${c.id}/resolve`, {
          method: 'POST',
          json: { linkUai: '0000000Z' },
        })
      ).status,
    ).toBe(422)
  })

  test('only admins reject; the photo is deleted', async () => {
    const { id, photoKey } = await proposal()
    expect((await as(moderator, `/api/staff/proposals/${id}`, { method: 'DELETE' })).status).toBe(
      403,
    )
    expect((await as(admin, `/api/staff/proposals/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await s.blobs.get(photoKey)).toBeNull()
  })
})

describe('site analytics', () => {
  test('overview and series have the shape the dashboard draws', async () => {
    await s.request('/api/analytics/beacon', {
      method: 'POST',
      json: { page: 'map', view: true, metrics: [{ name: 'LCP', value: 1800 }] },
      headers: { 'user-agent': 'Mozilla/5.0 Firefox' },
    })
    const o = (await (await as(admin, '/api/staff/analytics/overview?days=7')).json()) as {
      daily: unknown[]
      hourly: unknown[]
      pages: Array<{ page: string }>
      vitals: Array<{ metric: string; n: number }>
      todayVisitors: number
    }
    expect(o.daily).toHaveLength(7)
    expect(o.hourly).toHaveLength(24)
    expect(o.todayVisitors).toBe(1)
    expect(o.pages[0]?.page).toBe('map')
    expect(o.vitals.find((v) => v.metric === 'LCP')?.n).toBe(1)
    const series = (await (await as(admin, '/api/staff/analytics/series?range=24h')).json()) as {
      stepSeconds: number
      points: Array<{ views: number }>
      summary: { views: number }
    }
    expect(series.stepSeconds).toBe(900)
    expect(series.summary.views).toBe(1)
    expect((await as(admin, '/api/staff/analytics/series?range=1y')).status).toBe(422)
    expect((await as(moderator, '/api/staff/analytics/overview')).status).toBe(200)
    expect((await as(visitorless(), '/api/staff/analytics/overview')).status).toBe(401)
  })
})

describe('insights', () => {
  test('judged reports and media analyses', async () => {
    const id =
      (
        await s.ctx.db
          .insert(schema.reports)
          .values({
            schoolUai: lille,
            status: 'blocked',
            origin: 'press',
            sourceUrl: 'https://i.example/a',
            sourceDomain: 'i.example',
            moderation: 'approved',
            observedAt: new Date(),
          })
          .returning({ id: schema.reports.id })
      )[0]?.id ?? ''
    await s.ctx.db.insert(schema.judgements).values({
      reportId: id,
      provider: 'jev',
      model: 'jev-1.13.0',
      probability: 0.7,
      nature: 'blockade',
      level: 'secondary',
    })
    const rows = (await (await as(admin, '/api/staff/judge/reports')).json()) as Array<{
      id: string
      probability: number | null
      schoolName: string
    }>
    expect(rows.find((r) => r.id === id)).toMatchObject({
      probability: 0.7,
      schoolName: 'Lycée Pasteur',
    })
    expect((await as(moderator, '/api/staff/judge/reports')).status).toBe(403)

    const [m] = await s.ctx.db
      .insert(schema.mediaAnalyses)
      .values({
        url: 'https://i.example/a',
        domain: 'i.example',
        aboutMovement: true,
        mentionsDemands: false,
        focus: 'incidents',
        incidents: true,
        policeViolence: false,
        tone: 'neutral',
      })
      .returning({ id: schema.mediaAnalyses.id })
    const media = (await (await as(admin, '/api/staff/media')).json()) as Array<{ id: string }>
    expect(media.map((x) => x.id)).toContain(m?.id ?? '')
    expect((await as(admin, `/api/staff/media/${m?.id}`, { method: 'DELETE' })).status).toBe(204)
  })
})
