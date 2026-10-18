import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let admin: string
beforeAll(async () => {
  s = await startTestServer()
  admin = await signInStaff(s, 'admin@example.org', 'admin')
})
afterAll(() => s.close())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any
const as = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  s.request(path, { ...init, headers: { ...(init.headers as object), cookie: admin } })

const DAY = 86_400_000
const ROUTE = [
  [2.36, 48.86],
  [2.38, 48.85],
]
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

async function addEvent(movementId: string, title: string, days: number, route = true) {
  const res = await as(`/api/staff/movements/${movementId}/events`, {
    method: 'POST',
    json: {
      kind: 'march',
      title,
      startsAt: at(days),
      ...(route && { route: ROUTE, routeBasis: 'probable' }),
    },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as Loose).id as string
}

describe('marches on the home map', () => {
  let movementId = ''
  let hiddenId = ''

  test('empty while the setting is off, even with approved marches', async () => {
    const created = await as('/api/staff/movements', {
      method: 'POST',
      json: { name: 'Lycéens, automne 2026', startsAt: '2026-09-14T00:00:00Z' },
    })
    movementId = ((await created.json()) as Loose).id
    await addEvent(movementId, 'Aujourd’hui', 0)
    const res = await s.request('/api/marches')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    const settings = (await (await s.request('/api/settings')).json()) as Loose
    expect(settings.marches_on_map).toBe(false)
  })

  test('on: only approved, visible marches with a route, close to now', async () => {
    hiddenId = await addEvent(movementId, 'Masqué', 1)
    await addEvent(movementId, 'Sans parcours', 0, false)
    await addEvent(movementId, 'Il y a un mois', -30)
    await addEvent(movementId, 'Dans un mois', 30)
    await addEvent(movementId, 'Demain', 1)
    await as(`/api/staff/movement-events/${hiddenId}`, { method: 'PATCH', json: { hidden: true } })
    const on = await as('/api/staff/settings/marches_on_map', {
      method: 'PUT',
      json: { value: true },
    })
    expect(on.status).toBe(200)

    const res = await s.request('/api/marches')
    expect(res.headers.get('cache-control')).toContain('s-maxage=60')
    const marches = (await res.json()) as Loose[]
    expect(marches.map((m) => m.title)).toEqual(['Aujourd’hui', 'Demain'])
    expect(marches[0]).toMatchObject({ routeBasis: 'probable' })
    expect(marches[0].route).toEqual(ROUTE)
  })

  test('archiving the movement takes its marches off the map; reopening brings them back', async () => {
    const archive = await as(`/api/staff/movements/${movementId}`, {
      method: 'PATCH',
      json: { status: 'archived' },
    })
    expect(archive.status).toBe(200)
    expect(await (await s.request('/api/marches')).json()).toEqual([])
    await as(`/api/staff/movements/${movementId}`, { method: 'PATCH', json: { status: 'active' } })
    expect(((await (await s.request('/api/marches')).json()) as Loose[]).length).toBe(2)
  })

  test('the movement pages stay hidden: the two switches are independent', async () => {
    expect((await s.request('/api/movements')).status).toBe(404)
  })
})
