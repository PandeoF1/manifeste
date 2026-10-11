import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import type { BusEvent } from '../src/realtime/bus.ts'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let server: ReturnType<TestServer['listen']>
let adminCookie: string
let moderatorCookie: string

beforeAll(async () => {
  s = await startTestServer()
  await s.ctx.bus.start()
  server = s.listen()
  adminCookie = await signInStaff(s, 'admin@example.org', 'admin')
  moderatorCookie = await signInStaff(s, 'mod@example.org', 'moderator')
})
afterAll(async () => {
  await server.stop()
  await s.close()
})

/** Connects and collects every message until `close()`. Resolves once the socket is open. */
async function connect(path: string, cookie?: string) {
  const messages: BusEvent[] = []
  const ws = new WebSocket(`${server.wsUrl}${path}`, { headers: cookie ? { cookie } : {} } as never)
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)) as BusEvent)
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('websocket refused'))
  })
  return { messages, close: () => ws.close() }
}

async function waitFor(condition: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline && !condition()) await new Promise((r) => setTimeout(r, 50))
}

const settle = () => new Promise((r) => setTimeout(r, 300))

describe('event bus', () => {
  test('a published event reaches subscribers, a malformed notification is ignored', async () => {
    const seen: BusEvent[] = []
    const off = s.ctx.bus.subscribe((e) => seen.push(e))
    await s.ctx.bus.publish({ topic: 'statuses', data: { uai: '0590001A' } })
    await s.ctx.db.execute(sql`select pg_notify('manifeste_events', 'not json')`)
    await s.ctx.db.execute(sql`select pg_notify('manifeste_events', '{"topic":"unknown"}')`)
    await settle()
    off()
    expect(seen).toEqual([{ topic: 'statuses', data: { uai: '0590001A' } }])
  })

  test('the listener reconnects after its connection is killed', async () => {
    await s.ctx.db.execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'manifeste-events' and datname = current_database()`,
    )
    // First the drop is noticed, then the listener comes back (after a short backoff).
    await waitFor(() => !s.ctx.bus.isListening(), 3000)
    await waitFor(() => s.ctx.bus.isListening(), 6000)
    expect(s.ctx.bus.isListening()).toBe(true)
    const seen: BusEvent[] = []
    const off = s.ctx.bus.subscribe((e) => seen.push(e))
    await s.ctx.bus.publish({ topic: 'statuses' })
    await settle()
    off()
    expect(seen).toHaveLength(1)
  })
})

describe('WebSocket', () => {
  test('the public socket only hears about statuses', async () => {
    const client = await connect('/api/ws')
    await s.ctx.bus.publish({ topic: 'statuses', data: { uai: '0750001A' } })
    await s.ctx.bus.publish({ topic: 'moderation' })
    await s.ctx.bus.publish({ topic: 'pipeline' })
    await settle()
    client.close()
    expect(client.messages).toEqual([{ topic: 'statuses', data: { uai: '0750001A' } }])
  })

  test('the staff socket refuses visitors', async () => {
    await expect(connect('/api/ws/staff')).rejects.toThrow('refused')
  })

  test('moderators hear moderation, admins also hear the pipeline', async () => {
    const moderator = await connect('/api/ws/staff', moderatorCookie)
    const admin = await connect('/api/ws/staff', adminCookie)
    for (const topic of ['statuses', 'moderation', 'pipeline'] as const)
      await s.ctx.bus.publish({ topic })
    await settle()
    moderator.close()
    admin.close()
    expect(moderator.messages.map((m) => m.topic).sort()).toEqual(['moderation', 'statuses'])
    expect(admin.messages.map((m) => m.topic).sort()).toEqual([
      'moderation',
      'pipeline',
      'statuses',
    ])
  })

  test('a closed socket stops receiving', async () => {
    const client = await connect('/api/ws')
    client.close()
    await settle()
    await s.ctx.bus.publish({ topic: 'statuses' })
    await settle()
    expect(client.messages).toEqual([])
  })
})
