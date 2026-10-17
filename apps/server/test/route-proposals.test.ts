import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { MovementsService } from '../src/modules/movements/service.ts'
import { RouteProposalsService } from '../src/modules/movements/proposals.ts'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let admin: string
let moderator: string
let movementId: string
let service: RouteProposalsService
let routing: 'ok' | 'down' = 'ok'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

const fakeFetch = async (): Promise<Response> =>
  routing === 'down'
    ? new Response('', { status: 500 })
    : Response.json({
        code: 'Ok',
        routes: [
          {
            distance: 2500,
            geometry: {
              coordinates: [
                [3.07, 50.63],
                [3.06, 50.636],
                [3.063, 50.6366],
              ],
            },
          },
        ],
      })

beforeAll(async () => {
  s = await startTestServer()
  admin = await signInStaff(s, 'admin@example.org', 'admin')
  moderator = await signInStaff(s, 'mod@example.org', 'moderator')
  service = new RouteProposalsService(s.ctx.db, new MovementsService(s.ctx.db), fakeFetch)
})
afterAll(() => s.close())

const as = (cookie: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
  s.request(path, { ...init, headers: { ...(init.headers as object), cookie } })

const place = (
  name: string,
  lng: number | null,
  lat: number | null,
  status: 'ok' | 'weak' | 'none' = 'ok',
) => ({ name, quote: `… ${name} …`, lng, lat, status, label: null })

async function propose(over: Partial<typeof schema.routeProposals.$inferInsert> = {}) {
  const [row] = await s.ctx.db
    .insert(schema.routeProposals)
    .values({
      url: `https://press.example/${crypto.randomUUID()}`,
      domain: 'press.example',
      city: 'Lille',
      citycode: '59350',
      day: '2026-10-13',
      timing: 'announced',
      title: 'Marche des lycéens',
      places: [place('A', 3.07, 50.63), place('B', 3.06, 50.636), place('C', 3.063, 50.6366)],
      line: [
        [3.07, 50.63],
        [3.06, 50.636],
      ],
      lineKm: 2.5,
      warnings: [],
      groupKey: '59350|2026-10-13',
      ...over,
    })
    .returning()
  if (!row) throw new Error('no row')
  return row
}

beforeEach(async () => {
  routing = 'ok'
  await s.ctx.db.delete(schema.routeProposals)
  await s.ctx.db.delete(schema.movementEvents)
  await s.ctx.db.delete(schema.movements)
  const [m] = await s.ctx.db
    .insert(schema.movements)
    .values({ slug: 'lyceens', name: 'Lycéens', startsAt: new Date('2026-09-14') })
    .returning({ id: schema.movements.id })
  movementId = m?.id ?? ''
})

describe('route proposals: access', () => {
  test('only admins see and decide; moderators and anonymous are turned away', async () => {
    const p = await propose()
    expect((await as(admin, '/api/staff/route-proposals')).status).toBe(200)
    expect((await as(moderator, '/api/staff/route-proposals')).status).toBe(403)
    expect((await s.request('/api/staff/route-proposals')).status).toBe(401)
    const res = await as(moderator, `/api/staff/route-proposals/${p.id}/reject`, { method: 'POST' })
    expect(res.status).toBe(403)
  })

  test('the list shows pending ones first, decided ones on request', async () => {
    const a = await propose()
    await propose({ status: 'rejected' })
    const pending = (await (await as(admin, '/api/staff/route-proposals')).json()) as Loose[]
    expect(pending.map((x) => x.id)).toEqual([a.id])
    const decided = (await (
      await as(admin, '/api/staff/route-proposals?status=decided')
    ).json()) as Loose[]
    expect(decided).toHaveLength(1)
  })

  test('rejecting keeps the row, and a decided proposal cannot be decided again', async () => {
    const p = await propose()
    expect(
      (await as(admin, `/api/staff/route-proposals/${p.id}/reject`, { method: 'POST' })).status,
    ).toBe(200)
    const [row] = await s.ctx.db
      .select()
      .from(schema.routeProposals)
      .where(eq(schema.routeProposals.id, p.id))
    expect(row).toMatchObject({ status: 'rejected' })
    expect(
      (await as(admin, `/api/staff/route-proposals/${p.id}/reject`, { method: 'POST' })).status,
    ).toBe(409)
  })
})

describe('route proposals: approval', () => {
  test('approving creates a march with a "probable" route, from the article', async () => {
    const p = await propose()
    const out = await service.approve(p.id, {
      movementId,
      startsAt: new Date('2026-10-13T12:00:00Z'),
    })
    const [event] = await s.ctx.db.select().from(schema.movementEvents)
    expect(event).toMatchObject({
      id: out.eventId,
      movementId,
      kind: 'march',
      routeBasis: 'probable',
      sourceUrl: p.url,
      lng: 3.07,
      lat: 50.63,
    })
    expect(event?.route).toHaveLength(2)
    const [row] = await s.ctx.db.select().from(schema.routeProposals)
    expect(row).toMatchObject({ status: 'approved', eventId: out.eventId })
    await expect(service.approve(p.id, { movementId, startsAt: new Date() })).rejects.toThrow(
      'already decided',
    )
  })

  test('nothing is approved without a route or with a place that is not checked', async () => {
    const noLine = await propose({ line: null })
    await expect(service.approve(noLine.id, { movementId, startsAt: new Date() })).rejects.toThrow(
      'No route',
    )
    const weak = await propose({
      places: [place('A', 3.07, 50.63), place('B', 3.06, 50.636, 'weak')],
    })
    await expect(service.approve(weak.id, { movementId, startsAt: new Date() })).rejects.toThrow(
      'Every place',
    )
    expect(await s.ctx.db.select().from(schema.movementEvents)).toHaveLength(0)
  })

  test('approving can reject the other articles about the same march, and only those', async () => {
    const a = await propose()
    const b = await propose()
    const other = await propose({ groupKey: '69123|2026-10-13' })
    const out = await service.approve(a.id, {
      movementId,
      startsAt: new Date('2026-10-13T12:00:00Z'),
      rejectOthers: true,
    })
    expect(out.rejected).toEqual([b.id])
    const rows = await s.ctx.db.select().from(schema.routeProposals)
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [a.id]: 'approved',
      [b.id]: 'rejected',
      [other.id]: 'pending',
    })
  })
})

describe('route proposals: correction', () => {
  test('a point placed by hand counts as checked and the route is computed again', async () => {
    const p = await propose({
      places: [place('A', 3.07, 50.63), place('B', null, null, 'none'), place('C', 3.063, 50.6366)],
      line: null,
      warnings: ['Lieu introuvable : B'],
    })
    const { after } = await service.patch(p.id, {
      places: [
        { name: 'A', lng: 3.07, lat: 50.63 },
        { name: 'B', lng: 3.06, lat: 50.636 },
        { name: 'C', lng: 3.063, lat: 50.6366 },
      ],
    })
    expect(after.places.map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
    expect(after.places[1]?.label).toBe('Placé à la main')
    expect(after.warnings).toEqual([])
    expect(after.line).toHaveLength(3)
    expect(after.lineKm).toBe(2.5)
  })

  test('when the routing service is down there is no line and the warning says so', async () => {
    routing = 'down'
    const p = await propose()
    const { after } = await service.patch(p.id, {
      places: [
        { name: 'A', lng: 3.07, lat: 50.63 },
        { name: 'B', lng: 3.061, lat: 50.636 },
      ],
    })
    expect(after.line).toBeNull()
    expect(after.warnings).toContain('Le trajet à pied n’a pas pu être calculé')
  })

  test('changing the day moves the proposal to another group; a decided one cannot change', async () => {
    const p = await propose()
    const { after } = await service.patch(p.id, { day: '2026-10-14' })
    expect(after.groupKey).toBe('59350|2026-10-14')
    await service.reject(p.id)
    await expect(service.patch(p.id, { title: 'Autre titre' })).rejects.toThrow('already decided')
  })
})
