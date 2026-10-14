import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { addReport, addSchool } from './seed.ts'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let admin: { cookie: string }
let moderator: { cookie: string }

beforeAll(async () => {
  s = await startTestServer()
  admin = { cookie: await signInStaff(s, 'admin@example.org', 'admin') }
  moderator = { cookie: await signInStaff(s, 'mod@example.org', 'moderator') }
})
afterAll(() => s.close())

const as = (who: { cookie: string }, path: string, init: RequestInit & { json?: unknown } = {}) =>
  s.request(path, { ...init, headers: { ...(init.headers as object), cookie: who.cookie } })

describe('/api/staff/sources', () => {
  test('moderators and visitors are kept out', async () => {
    expect((await s.request('/api/staff/sources')).status).toBe(401)
    expect((await as(moderator, '/api/staff/sources')).status).toBe(403)
    expect((await as(moderator, '/api/staff/pipeline/overview')).status).toBe(403)
  })

  test('add: the identifier is normalised, checked and audited; a duplicate is refused', async () => {
    const bad = await as(admin, '/api/staff/sources', {
      method: 'POST',
      json: {
        kind: 'telegram',
        identifier: 'x',
        label: 'Bad',
        origin: 'aggregator',
        trusted: false,
      },
    })
    expect(bad.status).toBe(422)
    expect(await bad.text()).toContain('Telegram')

    const ok = await as(admin, '/api/staff/sources', {
      method: 'POST',
      json: {
        kind: 'telegram',
        identifier: 'https://t.me/s/MobiLycee',
        label: 'Mobilycee',
        origin: 'aggregator',
        trusted: false,
      },
    })
    expect(ok.status).toBe(200)
    const created = (await ok.json()) as {
      id: string
      identifier: string
      health: string
      stats: object
    }
    expect(created).toMatchObject({
      identifier: 'mobilycee',
      health: 'closed',
      stats: { items24h: 0, relevant24h: 0, reports7d: 0 },
    })

    const again = await as(admin, '/api/staff/sources', {
      method: 'POST',
      json: {
        kind: 'telegram',
        identifier: '@mobilycee',
        label: 'Again',
        origin: 'aggregator',
        trusted: false,
      },
    })
    expect(again.status).toBe(409)

    const audit = await s.ctx.db
      .select()
      .from(schema.moderationAudit)
      .where(eq(schema.moderationAudit.action, 'source.create'))
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actorEmail: 'admin@example.org', target: created.id })
  })

  test('tune, pause, read now, reset the breaker, delete', async () => {
    const [source] = await s.ctx.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.identifier, 'mobilycee'))
    const id = source?.id ?? ''
    const patch = await as(admin, `/api/staff/sources/${id}`, {
      method: 'PATCH',
      json: { enabled: false, trusted: true },
    })
    expect(patch.status).toBe(200)
    expect(await patch.json()).toMatchObject({ enabled: false, trusted: true })

    const run = await as(admin, `/api/staff/sources/${id}/run`, { method: 'POST' })
    expect(await run.json()).toEqual({ queued: true })

    await s.ctx.db
      .update(schema.sources)
      .set({
        health: 'open',
        consecutiveFailures: 5,
        nextAttemptAt: new Date(Date.now() + 3_600_000),
      })
      .where(eq(schema.sources.id, id))
    const reset = await as(admin, `/api/staff/sources/${id}/reset-health`, { method: 'POST' })
    expect(await reset.json()).toMatchObject({
      health: 'closed',
      consecutiveFailures: 0,
      nextAttemptAt: null,
    })

    expect(
      (await as(admin, `/api/staff/sources/${crypto.randomUUID()}/run`, { method: 'POST' })).status,
    ).toBe(404)
    expect((await as(admin, `/api/staff/sources/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(
      await s.ctx.db.select().from(schema.sources).where(eq(schema.sources.id, id)),
    ).toHaveLength(0)
  })

  test('presets: the catalogue, minus what is already added', async () => {
    const all = (await (await as(admin, '/api/staff/sources/presets')).json()) as Array<{
      kind: string
      identifier: string
      group: string
    }>
    expect(all.length).toBeGreaterThan(100)
    const first = all[0]
    await s.ctx.db
      .insert(schema.sources)
      .values({ kind: first?.kind as 'rss', identifier: first?.identifier ?? '', label: 'Preset' })
    const left = (await (await as(admin, '/api/staff/sources/presets')).json()) as unknown[]
    expect(left).toHaveLength(all.length - 1)
  })
})

describe('/api/staff/pipeline', () => {
  test('overview, events, items, throughput, retry and run-now', async () => {
    const [source] = await s.ctx.db
      .insert(schema.sources)
      .values({ kind: 'rss', identifier: 'https://x.example/feed', label: 'X' })
      .returning({ id: schema.sources.id })
    const sourceId = source?.id ?? ''
    const [failed, ok] = await s.ctx.db
      .insert(schema.ingestItems)
      .values([
        {
          sourceId,
          externalId: 'f',
          url: 'https://x.example/f',
          publishedAt: new Date(),
          state: 'failed',
          reason: 'read: boom',
        },
        {
          sourceId,
          externalId: 'o',
          url: 'https://x.example/o',
          publishedAt: new Date(),
          state: 'done',
        },
      ])
      .returning({ id: schema.ingestItems.id })
    await s.ctx.db.insert(schema.pipelineEvents).values([
      { stage: 'discover', outcome: 'ok', sourceId },
      { stage: 'read', outcome: 'ok', sourceId, itemId: ok?.id ?? null },
      { stage: 'read', outcome: 'failed', sourceId, itemId: failed?.id ?? null },
    ])

    const overview = (await (await as(admin, '/api/staff/pipeline/overview')).json()) as {
      states: Record<string, number>
      stages: Record<string, Record<string, number>>
      funnel: { discovered: number }
      stagesKnown: string[]
      queues: Array<{ name: string }>
    }
    expect(overview.states).toMatchObject({ failed: 1, done: 1 })
    expect(overview.stages.read).toEqual({ ok: 1, failed: 1 })
    expect(overview.funnel.discovered).toBe(2)
    expect(overview.stagesKnown).toContain('extract')
    expect(overview.queues.some((q) => q.name === 'ingest.read')).toBe(true)

    const events = (await (
      await as(admin, '/api/staff/pipeline/events?stage=read')
    ).json()) as Array<{ id: number; outcome: string }>
    expect(events.map((e) => e.outcome).sort()).toEqual(['failed', 'ok'])
    const newest = events[0]?.id ?? 0
    const tail = (await (
      await as(admin, `/api/staff/pipeline/events?after=${newest}`)
    ).json()) as unknown[]
    expect(tail).toEqual([])

    const lane = (await (
      await as(admin, '/api/staff/pipeline/items?state=failed')
    ).json()) as Array<{ id: string; source: string; reason: string }>
    expect(lane).toHaveLength(1)
    expect(lane[0]).toMatchObject({ source: 'X', reason: 'read: boom' })

    const throughput = (await (
      await as(admin, '/api/staff/pipeline/throughput?hours=2')
    ).json()) as Array<{ stage: string; n: number }>
    expect(throughput.find((r) => r.stage === 'read' && r.n === 1)).toBeTruthy()

    await s.ctx.db.insert(schema.pipelineEvents).values([
      { stage: 'read', outcome: 'ok', durationMs: 50 },
      { stage: 'read', outcome: 'ok', durationMs: 5000 },
    ])
    const latency = (await (
      await as(admin, '/api/staff/pipeline/latency?hours=2')
    ).json()) as Array<{
      stage: string
      n: number
      max: number
      histogram: number[]
    }>
    const read = latency.find((r) => r.stage === 'read')
    expect(read).toMatchObject({ n: 2, max: 5000 })
    expect(read?.histogram).toHaveLength(11)
    expect(read?.histogram.reduce((a, b) => a + b, 0)).toBe(2)

    const retry = await as(admin, '/api/staff/pipeline/retry', {
      method: 'POST',
      json: { itemIds: [failed?.id] },
    })
    expect(await retry.json()).toEqual({ retried: 1 })
    const [after] = await s.ctx.db
      .select()
      .from(schema.ingestItems)
      .where(eq(schema.ingestItems.id, failed?.id ?? ''))
    expect(after).toMatchObject({ state: 'discovered', reason: null, attempts: 0 })

    expect(await (await as(admin, '/api/staff/pipeline/run', { method: 'POST' })).json()).toEqual({
      queued: true,
    })
    const actions = (await s.ctx.db.select().from(schema.moderationAudit)).map((a) => a.action)
    expect(actions).toContain('pipeline.retry')
    expect(actions).toContain('pipeline.run-now')
  })
})

describe('/api/staff/pipeline/operations', () => {
  const post = (json: unknown) =>
    as(admin, '/api/staff/pipeline/operations', { method: 'POST', json })

  test('a dry run is the default, answered at once, and costs nothing', async () => {
    const res = await post({ kind: 'rematch' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      kind: 'rematch',
      dryRun: true,
      summary: { waiting: 0 },
    })
    const dry = await post({ kind: 'reextract', sinceHours: 24, dryRun: true })
    expect(await dry.json()).toMatchObject({ kind: 'reextract', dryRun: true })
  })

  test('a real run is queued, and audited', async () => {
    const res = await post({ kind: 'backfill', sinceHours: 72, dryRun: false })
    expect(await res.json()).toEqual({ queued: true })
    const lines = await s.ctx.db
      .select()
      .from(schema.moderationAudit)
      .where(eq(schema.moderationAudit.action, 'pipeline.backfill'))
    expect(lines.at(-1)?.after).toMatchObject({ kind: 'backfill', sinceHours: 72, dryRun: false })
  })

  test('what an operation needs is checked; moderators cannot start one', async () => {
    expect((await post({ kind: 'backfill' })).status).toBe(422)
    expect((await post({ kind: 'nonsense' })).status).toBe(422)
    const res = await as(moderator, '/api/staff/pipeline/operations', {
      method: 'POST',
      json: { kind: 'rematch' },
    })
    expect(res.status).toBe(403)
  })
})

describe('optional filters have no hidden default', () => {
  test('listing items without a state returns every state', async () => {
    const all = (await (await as(admin, '/api/staff/pipeline/items')).json()) as Array<{
      state: string
    }>
    expect(new Set(all.map((i) => i.state)).size).toBeGreaterThan(1)
  })
})

describe('hiding the reports of a source', () => {
  test('switching it on hides what the source already published; off leaves the past alone', async () => {
    const uai = await addSchool(s.ctx.db, { name: 'Lycée Caché', city: 'Lille' })
    const [src] = await s.ctx.db
      .insert(schema.sources)
      .values({
        kind: 'rss',
        identifier: 'https://m.example/feed',
        label: 'Misled',
        origin: 'press',
      })
      .returning({ id: schema.sources.id })
    const sourceId = src?.id ?? ''
    const own = await addReport(s.ctx.db, { schoolUai: uai, sourceId })
    const handHidden = await addReport(s.ctx.db, { schoolUai: uai, sourceId, hidden: true })
    const other = await addReport(s.ctx.db, { schoolUai: uai })
    const hidden = async (id: string) =>
      (await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id)))[0]?.hidden

    const on = await as(admin, `/api/staff/sources/${sourceId}`, {
      method: 'PATCH',
      json: { reportsHidden: true },
    })
    expect(on.status).toBe(200)
    expect(await hidden(own)).toBe(true)
    expect(await hidden(handHidden)).toBe(true)
    // Another source's report is none of its business.
    expect(await hidden(other)).toBe(false)
    const [line] = await s.ctx.db
      .select()
      .from(schema.moderationAudit)
      .where(eq(schema.moderationAudit.target, sourceId))
    expect(JSON.stringify(line?.after)).toContain('"reportsHiddenNow":1')

    await as(admin, `/api/staff/sources/${sourceId}`, {
      method: 'PATCH',
      json: { reportsHidden: false },
    })
    expect(await hidden(own)).toBe(true) // not guessed back: unhide by hand
  })
})
