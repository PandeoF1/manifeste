import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
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

// The published JSON is loosely shaped; the tests assert on the pieces they care about.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any

const as = (cookie: string, path: string, init: RequestInit & { json?: unknown } = {}) =>
  s.request(path, { ...init, headers: { ...(init.headers as object), cookie } })

const create = (json: unknown, cookie = admin) =>
  as(cookie, '/api/staff/movements', { method: 'POST', json })

const REPUBLIQUE_NATION = [
  [2.3637, 48.8675],
  [2.3787, 48.8559],
  [2.3959, 48.8483],
]

describe('movements: hidden until the setting is on', () => {
  test('by default the public pages do not exist, but staff can already prepare content', async () => {
    expect((await s.request('/api/movements')).status).toBe(404)
    expect((await s.request('/api/movements/anything')).status).toBe(404)
    expect((await as(admin, '/api/staff/movements')).status).toBe(200)
    expect((await as(moderator, '/api/staff/movements')).status).toBe(403)
    // The public settings tell the web app to leave the menu entry out.
    const settings = (await (await s.request('/api/settings')).json()) as Loose
    expect(settings.movements_public).toBe(false)
  })

  test('staff can switch them on, and the settings follow', async () => {
    const res = await as(admin, '/api/staff/settings/movements_public', {
      method: 'PUT',
      json: { value: true },
    })
    expect(res.status).toBe(200)
    const settings = (await (await s.request('/api/settings')).json()) as Loose
    expect(settings.movements_public).toBe(true)
  })
})

describe('movements: public reads', () => {
  test('nothing yet: an empty list, and an unknown address is a 404', async () => {
    const res = await s.request('/api/movements')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=60')
    expect(await res.json()).toEqual([])
    expect((await s.request('/api/movements/nope')).status).toBe(404)
  })

  test('a malformed address is refused before the database', async () => {
    expect((await s.request('/api/movements/Not%20A%20Slug')).status).toBe(422)
  })
})

describe('movements: staff writes', () => {
  test('only admins create; anonymous and moderators are turned away', async () => {
    const body = { name: 'Lycéens, automne 2026', startsAt: '2026-09-14T00:00:00Z' }
    expect((await create(body, '')).status).toBe(401)
    expect((await create(body, moderator)).status).toBe(403)
    const res = await create(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      slug: 'lyceens-automne-2026',
      status: 'active',
      eventCount: 0,
    })
  })

  test('an address already taken is a 409; a name with no usable address is a 422', async () => {
    const taken = await create({
      name: 'Autre nom',
      slug: 'lyceens-automne-2026',
      startsAt: '2026-10-01T00:00:00Z',
    })
    expect(taken.status).toBe(409)
    expect((await create({ name: '???', startsAt: '2026-10-01T00:00:00Z' })).status).toBe(422)
  })

  test('creation is audited', async () => {
    const lines = await s.ctx.db
      .select()
      .from(schema.moderationAudit)
      .where(eq(schema.moderationAudit.action, 'movement.create'))
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines[0]?.target).toBe('lyceens-automne-2026')
  })
})

describe('events and routes', () => {
  let movementId = ''
  const event = (json: unknown, cookie = admin) =>
    as(cookie, `/api/staff/movements/${movementId}/events`, { method: 'POST', json })

  beforeAll(async () => {
    const list = (await (await s.request('/api/movements')).json()) as Loose[]
    movementId = list.find((m) => m.slug === 'lyceens-automne-2026').id
  })

  test('a march with its announced route is published and served with the movement', async () => {
    const res = await event({
      kind: 'march',
      title: 'Cortège République - Nation',
      place: 'Paris',
      startsAt: '2026-10-17T14:00:00Z',
      endsAt: '2026-10-17T17:00:00Z',
      lat: 48.8675,
      lng: 2.3637,
      route: REPUBLIQUE_NATION,
      routeBasis: 'announced',
      sourceUrl: 'https://www.exemple.fr/article',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      kind: 'march',
      routeBasis: 'announced',
      sourceDomain: 'exemple.fr',
    })

    const page = (await (await s.request('/api/movements/lyceens-automne-2026')).json()) as Loose
    expect(page.movement.eventCount).toBe(1)
    expect(page.events[0].route).toEqual(REPUBLIQUE_NATION)
  })

  test('what would put a wrong line on the map is refused', async () => {
    const base = { kind: 'march', title: 'Cortège test', startsAt: '2026-10-18T14:00:00Z' }
    const refused: unknown[] = [
      // a route needs to say how reliable it is
      { ...base, route: REPUBLIQUE_NATION },
      // coordinates out of range
      {
        ...base,
        route: [
          [2, 48],
          [200, 10],
        ],
        routeBasis: 'probable',
      },
      // a position is a pair
      { ...base, lat: 48.8 },
      // sources are https
      { ...base, sourceUrl: 'http://exemple.fr/a' },
      // ends before it starts
      { ...base, endsAt: '2026-10-18T10:00:00Z' },
    ]
    for (const body of refused) expect((await event(body)).status).toBe(422)
    expect((await event(base, moderator)).status).toBe(403)
    const unknown = await as(
      admin,
      '/api/staff/movements/6b4f0e4a-0000-4000-8000-000000000000/events',
      {
        method: 'POST',
        json: base,
      },
    )
    expect(unknown.status).toBe(404)
  })

  test('a hidden event leaves the public page; a cancelled one stays, marked as such', async () => {
    const page = (await (await s.request('/api/movements/lyceens-automne-2026')).json()) as Loose
    const id = page.events[0].id as string

    const cancel = await as(admin, `/api/staff/movement-events/${id}`, {
      method: 'PATCH',
      json: { status: 'cancelled' },
    })
    expect(cancel.status).toBe(200)
    const after = (await (await s.request('/api/movements/lyceens-automne-2026')).json()) as Loose
    expect(after.events[0].status).toBe('cancelled')

    await as(admin, `/api/staff/movement-events/${id}`, { method: 'PATCH', json: { hidden: true } })
    const hidden = (await (await s.request('/api/movements/lyceens-automne-2026')).json()) as Loose
    expect(hidden.events).toEqual([])
    expect(hidden.movement.eventCount).toBe(0)
  })

  test('staff see the hidden events too; the public does not; moderators are turned away', async () => {
    const asStaff = (cookie: string) => as(cookie, `/api/staff/movements/${movementId}/events`)
    expect((await asStaff('')).status).toBe(401)
    expect((await asStaff(moderator)).status).toBe(403)
    const all = (await (await asStaff(admin)).json()) as Loose[]
    const publicPage = (await (
      await s.request('/api/movements/lyceens-automne-2026')
    ).json()) as Loose
    // The event hidden above is in the staff list, flagged, and not on the public page.
    expect(all.some((e) => e.hidden === true)).toBe(true)
    expect(publicPage.events.every((e: Loose) => e.hidden === undefined)).toBe(true)
    expect(all.length).toBeGreaterThan(publicPage.events.length)
    const unknown = await as(
      admin,
      '/api/staff/movements/6b4f0e4a-0000-4000-8000-000000000000/events',
    )
    expect(unknown.status).toBe(404)
  })

  test('removing a route clears its basis too', async () => {
    const made = (await (
      await event({
        kind: 'march',
        title: 'Cortège à corriger',
        startsAt: '2026-10-19T14:00:00Z',
        route: REPUBLIQUE_NATION,
        routeBasis: 'probable',
      })
    ).json()) as Loose
    await as(admin, `/api/staff/movement-events/${made.id}`, {
      method: 'PATCH',
      json: { route: null },
    })
    const [row] = await s.ctx.db
      .select()
      .from(schema.movementEvents)
      .where(eq(schema.movementEvents.id, made.id))
    expect(row?.route).toBeNull()
    expect(row?.routeBasis).toBeNull()
  })
})

describe('partial edits do not reset what they do not mention', () => {
  test('renaming an event keeps it cancelled; renaming an archive keeps it archived', async () => {
    const ev = await s.ctx.db
      .insert(schema.movementEvents)
      .values({
        kind: 'rally',
        title: 'Rassemblement',
        startsAt: new Date('2026-11-01T10:00:00Z'),
        status: 'cancelled',
        moderation: 'approved',
      })
      .returning({ id: schema.movementEvents.id })
    const eventId = ev[0]?.id ?? ''
    const renamed = await as(admin, `/api/staff/movement-events/${eventId}`, {
      method: 'PATCH',
      json: { title: 'Rassemblement place de la Mairie' },
    })
    expect(renamed.status).toBe(200)
    const [row] = await s.ctx.db
      .select()
      .from(schema.movementEvents)
      .where(eq(schema.movementEvents.id, eventId))
    expect(row).toMatchObject({ status: 'cancelled', title: 'Rassemblement place de la Mairie' })

    const [old] = await s.ctx.db
      .insert(schema.movements)
      .values({
        slug: 'ancien',
        name: 'Ancien mouvement',
        status: 'archived',
        startsAt: new Date('2025-01-01T00:00:00Z'),
        endsAt: new Date('2025-03-01T00:00:00Z'),
      })
      .returning({ id: schema.movements.id })
    await as(admin, `/api/staff/movements/${old?.id}`, {
      method: 'PATCH',
      json: { description: 'Archivé' },
    })
    const [after] = await s.ctx.db
      .select()
      .from(schema.movements)
      .where(eq(schema.movements.id, old?.id ?? ''))
    expect(after).toMatchObject({ status: 'archived', description: 'Archivé' })
    expect(after?.endsAt?.toISOString()).toBe('2025-03-01T00:00:00.000Z')
  })
})

describe('archiving', () => {
  test('archiving sets the end date and keeps the page; active movements are listed first', async () => {
    const second = (await (
      await create({ name: 'Climat, printemps 2027', startsAt: '2027-03-01T00:00:00Z' })
    ).json()) as Loose
    const list = (await (await s.request('/api/movements')).json()) as Loose[]
    const first = list.find((m) => m.slug === 'lyceens-automne-2026')

    const done = await as(admin, `/api/staff/movements/${first.id}`, {
      method: 'PATCH',
      json: { status: 'archived', endsAt: '2026-12-20T00:00:00Z' },
    })
    expect(done.status).toBe(200)

    const after = (await (await s.request('/api/movements')).json()) as Loose[]
    // Other tests add movements too: look at ours, in the order of the list.
    const ours = after.filter((m) => [second.slug, 'lyceens-automne-2026'].includes(m.slug))
    expect(ours.map((m) => [m.slug, m.status])).toEqual([
      [second.slug, 'active'],
      ['lyceens-automne-2026', 'archived'],
    ])
    // Active movements come before every archive.
    const firstArchive = after.findIndex((m) => m.status === 'archived')
    expect(after.slice(firstArchive).every((m) => m.status === 'archived')).toBe(true)
    // The archive still answers, with its end date.
    const page = (await (await s.request('/api/movements/lyceens-automne-2026')).json()) as Loose
    expect(page.movement.endsAt).toBe('2026-12-20T00:00:00.000Z')

    // Reopening clears the end date.
    await as(admin, `/api/staff/movements/${first.id}`, {
      method: 'PATCH',
      json: { status: 'active' },
    })
    const reopened = (await (
      await s.request('/api/movements/lyceens-automne-2026')
    ).json()) as Loose
    expect(reopened.movement).toMatchObject({ status: 'active', endsAt: null })
  })

  test('an end before the start is refused', async () => {
    const list = (await (await s.request('/api/movements')).json()) as Loose[]
    const m = list[0]
    const res = await as(admin, `/api/staff/movements/${m.id}`, {
      method: 'PATCH',
      json: { endsAt: '2000-01-01T00:00:00Z' },
    })
    expect(res.status).toBe(422)
  })
})
