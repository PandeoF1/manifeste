import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createAi, type AiConfig } from '@manifeste/ai'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { IngestOperations } from '../../src/ingest/operations.ts'
import { IngestService } from '../../src/ingest/service.ts'
import { startTestServer, type TestServer } from '../helpers.ts'
import { addSchool } from '../seed.ts'
import { NOW, aiConfig, event, fetchFn, geminiFetch, page, rss, world } from './world.ts'

let s: TestServer
let ops: IngestOperations
let ingest: IngestService
let sourceId: string
let lille: string

beforeAll(async () => {
  s = await startTestServer()
  lille = await addSchool(s.ctx.db, { name: 'Lycée Pasteur', city: 'Lille', lat: 50.63, lng: 3.06 })
})
afterAll(() => s.close())

const build = (ai: AiConfig = aiConfig(), fetchOverride = fetchFn) => {
  ingest = new IngestService(s.ctx, {
    fetchFn: fetchOverride,
    now: () => NOW,
    ai: createAi(ai, { fetch: geminiFetch, sleep: async () => {} }),
    trigger: async () => {},
    config: { readerGateway: false, extractMaxWaitMinutes: 0, mediaMaxWaitMinutes: 0 },
  })
  ops = new IngestOperations(ingest)
}

beforeEach(async () => {
  const db = s.ctx.db
  await db.delete(schema.reports)
  await db.delete(schema.unmatched)
  await db.delete(schema.ingestItems)
  await db.delete(schema.pipelineEvents)
  await db.delete(schema.sources)
  const [row] = await db
    .insert(schema.sources)
    .values({
      kind: 'rss',
      identifier: 'https://press.example/feed',
      label: 'Press feed',
      origin: 'press',
    })
    .returning({ id: schema.sources.id })
  sourceId = row?.id ?? ''
  Object.assign(world, { down: false, geminiCalls: 0, geminiDown: false, pages: {} })
  world.feed = rss([
    { guid: 'a1', title: 'Lycée Pasteur bloqué à Lille', link: 'https://press.example/pasteur' },
  ])
  world.pages['https://press.example/pasteur'] = page(
    'Lycée Pasteur bloqué à Lille',
    'lycée Pasteur de Lille',
  )
  world.facts = [{ when: 'lycée Pasteur', events: [event()] }]
  build()
})

const reports = () => s.ctx.db.select().from(schema.reports)
const jobEvents = async () =>
  (await s.ctx.db.select().from(schema.pipelineEvents)).filter((e) => e.stage === 'job')

describe('backfill', () => {
  test('dry run counts, a real run reads over the longer window', async () => {
    // An article from two days ago (a Monday): outside the usual 48-hour memory.
    world.feed = rss([
      {
        guid: 'old',
        title: 'Lycée Pasteur bloqué à Lille',
        link: 'https://press.example/pasteur',
        pub: 'Mon, 05 Oct 2026 08:30:00 GMT',
      },
    ])
    const dry = await ops.run({ kind: 'backfill', sinceHours: 240 }, { dryRun: true })
    expect(dry).toMatchObject({ dryRun: true, summary: { sources: 1, sinceHours: 240 } })
    expect(await s.ctx.db.select().from(schema.ingestItems)).toHaveLength(0)

    expect((await ingest.discover(sourceId, 'manual')).newItems).toBe(0) // outside the normal window
    const run = await ops.run({ kind: 'backfill', sinceHours: 240 }, { dryRun: false })
    expect(run.summary).toMatchObject({ sources: 1, newItems: 1, relevant: 1 })
    expect(await reports()).toHaveLength(1)
  })

  test('a failing source is counted, not fatal', async () => {
    world.down = true
    const run = await ops.run({ kind: 'backfill', sinceHours: 48 }, { dryRun: false })
    expect(run.summary).toMatchObject({ sources: 1, failedSources: 1, newItems: 0 })
  })
})

describe('reextract', () => {
  test('dry run says what is recoverable; a real run asks the AI again without duplicating reports', async () => {
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect(world.geminiCalls).toBe(1)
    const dry = await ops.run({ kind: 'reextract', sinceHours: 48 }, { dryRun: true })
    expect(dry.summary).toMatchObject({
      items: 1,
      fromStoredText: 1,
      unrecoverable: 0,
      estimatedAiCalls: 1,
    })
    expect(world.geminiCalls).toBe(1)

    await ops.run({ kind: 'reextract', sinceHours: 48 }, { dryRun: false })
    expect(world.geminiCalls).toBe(2)
    expect(await reports()).toHaveLength(1)
    const outcomes = (await s.ctx.db.select().from(schema.extractions)).map((e) => e.outcome).sort()
    expect(outcomes).toEqual(['duplicate', 'reported'])
  })

  test('items whose text is gone: a press article is fetched again, a post cannot be', async () => {
    const [post] = await s.ctx.db
      .insert(schema.sources)
      .values({ kind: 'telegram', identifier: 'mobilycee', label: 'T' })
      .returning({ id: schema.sources.id })
    await s.ctx.db.insert(schema.ingestItems).values([
      {
        sourceId,
        externalId: 'gone-rss',
        url: 'https://press.example/pasteur',
        publishedAt: NOW,
        state: 'done',
      },
      {
        sourceId: post?.id ?? '',
        externalId: 'gone-post',
        url: 'https://t.me/m/1',
        publishedAt: NOW,
        state: 'done',
      },
    ])
    const dry = await ops.run({ kind: 'reextract', sinceHours: 48 }, { dryRun: true })
    expect(dry.summary).toMatchObject({
      items: 2,
      fromStoredText: 0,
      refetched: 1,
      unrecoverable: 1,
    })
  })
})

describe('rejudge', () => {
  const judged = (probability: number) =>
    createAi(
      {
        ...aiConfig(),
        credentials: { gemini: { apiKey: 'k' }, jev: { apiKey: 'j' }, openaiCompatible: {} },
        tasks: { ...aiConfig().tasks, judge: { kind: 'jev', model: 'jev-1.13.0' } },
      },
      {
        fetch: async (url) =>
          String(url).includes('typesafe')
            ? new Response(
                JSON.stringify({
                  answers: {
                    bloque: { noul: probability },
                    nature: { choice: 'blocage' },
                    level: { choice: 'lycee' },
                  },
                }),
              )
            : geminiFetch(String(url)),
      },
    )

  async function seedReport() {
    const [row] = await s.ctx.db
      .insert(schema.reports)
      .values({
        schoolUai: lille,
        status: 'blocked',
        origin: 'press',
        sourceId,
        sourceUrl: 'https://press.example/pasteur',
        sourceDomain: 'press.example',
        moderation: 'approved',
        observedAt: NOW,
        publishedAt: NOW,
        createdAt: NOW,
      })
      .returning({ id: schema.reports.id })
    return row?.id ?? ''
  }

  test('reads the article again, judges it, records the opinion and the tier', async () => {
    const id = await seedReport()
    ingest.deps.ai = judged(0.9)
    const dry = await ops.run({ kind: 'rejudge', sinceHours: 48 }, { dryRun: true })
    expect(dry.summary).toMatchObject({ reports: 1 })
    expect(Number(dry.summary.estimatedUsd)).toBeGreaterThan(0)

    const run = await ops.run({ kind: 'rejudge', sinceHours: 48 }, { dryRun: false })
    expect(run.summary).toMatchObject({ reports: 1, judged: 1, unreadable: 0 })
    const [judgement] = await s.ctx.db
      .select()
      .from(schema.judgements)
      .where(eq(schema.judgements.reportId, id))
    expect(judgement).toMatchObject({ provider: 'jev', nature: 'blockade', level: 'secondary' })
    expect(judgement?.probability).toBeCloseTo(0.9)
    expect((await reports())[0]?.tier).toBe('confirmed')

    // Judged reports are not judged twice.
    expect(
      (await ops.run({ kind: 'rejudge', sinceHours: 48 }, { dryRun: true })).summary,
    ).toMatchObject({ reports: 0 })
  })

  test('a judge that is off says so; an unreadable article is counted', async () => {
    await seedReport()
    expect(
      (await ops.run({ kind: 'rejudge', sinceHours: 48 }, { dryRun: false })).summary,
    ).toMatchObject({ note: 'the judge is switched off' })
    world.pages = {}
    ingest.deps.ai = judged(0.9)
    expect(
      (await ops.run({ kind: 'rejudge', sinceHours: 48 }, { dryRun: false })).summary,
    ).toMatchObject({ judged: 0, unreadable: 1 })
  })
})

describe('rematch', () => {
  async function unmatchedFact() {
    world.facts = [
      {
        when: 'lycée Pasteur',
        events: [event({ school_name: 'Lycée Louis Pasteur', city: 'Lille' })],
      },
    ]
    // The directory does not know "Louis Pasteur at Lil" well enough yet.
    await s.ctx.db
      .update(schema.schools)
      .set({ name: 'Lycée Gambetta' })
      .where(eq(schema.schools.uai, lille))
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect(await s.ctx.db.select().from(schema.unmatched)).toHaveLength(1)
  }
  afterAll(async () => {
    await s.ctx.db
      .update(schema.schools)
      .set({ name: 'Lycée Pasteur' })
      .where(eq(schema.schools.uai, lille))
  })

  test('once the directory knows the school, the waiting fact becomes a report', async () => {
    await unmatchedFact()
    expect((await ops.run({ kind: 'rematch' }, { dryRun: false })).summary).toMatchObject({
      waiting: 1,
      matched: 0,
      stillUnmatched: 1,
    })
    await s.ctx.db
      .update(schema.schools)
      .set({ name: 'Lycée Louis Pasteur', city: 'Lille' })
      .where(eq(schema.schools.uai, lille))
    const run = await ops.run({ kind: 'rematch' }, { dryRun: false })
    expect(run.summary).toMatchObject({ waiting: 1, matched: 1, reports: 1 })
    expect(await reports()).toHaveLength(1)
    const [row] = await s.ctx.db.select().from(schema.unmatched)
    expect(row).toMatchObject({ resolution: 'matched', linkedUai: lille })
    expect(row?.resolvedAt).toBeTruthy()
    const [extraction] = await s.ctx.db.select().from(schema.extractions)
    expect(extraction).toMatchObject({ outcome: 'reported', schoolUai: lille })
    // Nothing is left to do, and nothing new was queued for staff.
    expect((await ops.run({ kind: 'rematch' }, { dryRun: true })).summary).toMatchObject({
      waiting: 0,
    })
  })

  test('with the AI: it picks the school among the candidates, never one it was not offered', async () => {
    await unmatchedFact()
    const reanalysis = (uai: string | null) =>
      createAi(aiConfig(), {
        fetch: async (_url, init) => {
          const prompt =
            (
              JSON.parse(String(init?.body)) as {
                contents: Array<{ parts: Array<{ text: string }> }>
              }
            ).contents[0]?.parts[0]?.text ?? ''
          const items = JSON.parse(prompt.slice(prompt.indexOf('['))) as Array<{ id: string }>
          const choices = items.map((i) => ({ id: i.id, uai, certainty: 'haute' }))
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: JSON.stringify({ choices }) }] } }],
            }),
          )
        },
        sleep: async () => {},
      })
    ingest.deps.ai = reanalysis('9999999Z')
    expect(
      (await ops.run({ kind: 'rematch', useAi: true }, { dryRun: false })).summary,
    ).toMatchObject({ matched: 0 })
    ingest.deps.ai = reanalysis(lille)
    const run = await ops.run({ kind: 'rematch', useAi: true }, { dryRun: false })
    expect(run.summary).toMatchObject({ matched: 1, reports: 1 })
    expect((await reports())[0]?.schoolUai).toBe(lille)
  })

  test('dry run: nothing changes', async () => {
    await unmatchedFact()
    const dry = await ops.run({ kind: 'rematch', useAi: true }, { dryRun: true })
    expect(dry.summary).toMatchObject({ waiting: 1, estimatedAiCalls: 1 })
    expect(await reports()).toHaveLength(0)
  })
})

describe('every operation reports itself', () => {
  test('started and completed (or dry-run) events carry the summary', async () => {
    await ops.run({ kind: 'rematch' }, { dryRun: true })
    await ops.run({ kind: 'backfill', sinceHours: 48 }, { dryRun: false })
    const events = await jobEvents()
    expect(events.map((e) => e.outcome).sort()).toEqual([
      'completed',
      'dry-run',
      'started',
      'started',
    ])
    expect(events.find((e) => e.outcome === 'completed')?.detail).toMatchObject({
      kind: 'backfill',
      sources: 1,
    })
  })
})
