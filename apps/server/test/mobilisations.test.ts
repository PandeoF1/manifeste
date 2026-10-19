import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let admin: string
let moderator: string
beforeAll(async () => {
  s = await startTestServer()
  admin = await signInStaff(s, 'admin@example.org', 'admin')
  moderator = await signInStaff(s, 'mod@example.org', 'moderator')
})
afterAll(() => s.close())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any
const as = (cookie: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
  s.request(path, { ...init, headers: { ...(init.headers as object), cookie } })

const HOUR = 3_600_000
const ZONE = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [2.34, 48.82],
      [2.37, 48.82],
      [2.37, 48.84],
      [2.34, 48.82],
    ],
  ] as Array<Array<[number, number]>>,
}
let n = 0
async function signaled(
  title: string,
  hoursAgo: number,
  over: Partial<typeof schema.movementEvents.$inferInsert> = {},
) {
  const [row] = await s.ctx.db
    .insert(schema.movementEvents)
    .values({
      movementId: null,
      kind: 'signaled',
      title,
      place: 'Paris',
      startsAt: new Date(Date.now() - hoursAgo * HOUR),
      lat: 48.83,
      lng: 2.35,
      precision: 'point',
      citycode: '75056',
      dedupeKey: `k${n++}`,
      moderation: 'approved',
      ...over,
    })
    .returning({ id: schema.movementEvents.id })
  return row?.id ?? ''
}

describe('signaled mobilisations API', () => {
  test('empty while the setting is off', async () => {
    await signaled('Place de la République', 1)
    expect(await (await s.request('/api/mobilisations')).json()).toEqual([])
    const settings = (await (await s.request('/api/settings')).json()) as Loose
    expect(settings.signaled_mobilisations).toBe(false)
  })

  test('on: the period decides how far back; hidden and pending ones are never served', async () => {
    await signaled('Hier soir', 12)
    await signaled('Il y a cinq jours', 5 * 24)
    await signaled('Zone du 13e', 2, { zone: ZONE, precision: 'district' })
    const hiddenId = await signaled('Masquée', 1)
    await signaled('En attente', 1, { moderation: 'pending' })
    await signaled('Dans un mois', -30 * 24)
    await as(admin, `/api/staff/movement-events/${hiddenId}`, {
      method: 'PATCH',
      json: { hidden: true },
    })
    const on = await as(admin, '/api/staff/settings/signaled_mobilisations', {
      method: 'PUT',
      json: { value: true },
    })
    expect(on.status).toBe(200)

    const titles = async (period?: string) =>
      (
        (await (
          await s.request(`/api/mobilisations${period ? `?period=${period}` : ''}`)
        ).json()) as Loose[]
      ).map((m) => m.title)
    expect(await titles()).toEqual(['Place de la République', 'Zone du 13e'])
    expect(await titles('24h')).toEqual(['Place de la République', 'Zone du 13e', 'Hier soir'])
    expect(await titles('7d')).toContain('Il y a cinq jours')
    expect(await titles('all')).not.toContain('Masquée')
    expect(await titles('all')).not.toContain('En attente')
    expect(await titles('all')).not.toContain('Dans un mois')
    expect((await s.request('/api/mobilisations?period=forever')).status).toBe(422)
  })

  test('a zone and its precision travel with the event', async () => {
    const res = (await (await s.request('/api/mobilisations')).json()) as Loose[]
    const zone = res.find((m) => m.title === 'Zone du 13e')
    expect(zone).toMatchObject({ kind: 'signaled', precision: 'district' })
    expect(zone.zone.coordinates[0]).toHaveLength(4)
    const point = res.find((m) => m.title === 'Place de la République')
    expect(point).toMatchObject({ precision: 'point', zone: null })
  })

  test('they follow no movement: they appear on no movement page and not among the marches', async () => {
    expect(await (await s.request('/api/marches?period=all')).json()).toEqual([])
  })

  test('staff list them, hidden ones included; only admins', async () => {
    const list = (await (await as(admin, '/api/staff/mobilisations')).json()) as Loose[]
    expect(list.map((m) => m.title)).toContain('Masquée')
    expect(list.find((m) => m.title === 'Masquée')?.hidden).toBe(true)
    expect((await as(moderator, '/api/staff/mobilisations')).status).toBe(403)
    expect((await s.request('/api/staff/mobilisations')).status).toBe(401)
  })
})
