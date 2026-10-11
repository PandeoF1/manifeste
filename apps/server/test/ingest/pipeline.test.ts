import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createAi, createMeter, DEFAULT_AI_CONFIG, type AiConfig } from '@manifeste/ai'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { IngestService } from '../../src/ingest/service.ts'
import { addSchool } from '../seed.ts'
import { startTestServer, type TestServer } from '../helpers.ts'

let s: TestServer
let lille: string
beforeAll(async () => {
  s = await startTestServer()
  lille = await addSchool(s.ctx.db, { name: 'Lycée Pasteur', city: 'Lille', lat: 50.63, lng: 3.06 })
  await addSchool(s.ctx.db, {
    name: 'Université de Nanterre',
    city: 'Nanterre',
    level: 'higher',
    lat: 48.9,
    lng: 2.21,
  })
})
afterAll(() => s.close())

// --- A tiny world: a feed, article pages and a model that reads the prompt ---------------------

/** A Wednesday: lycées are open. */
const NOW = new Date('2026-10-07T10:00:00Z')
const rss = (items: Array<{ guid: string; title: string; link: string; pub?: string }>) =>
  `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map(
      (i) =>
        `<item><guid>${i.guid}</guid><title>${i.title}</title><link>${i.link}</link><pubDate>${i.pub ?? 'Wed, 07 Oct 2026 08:30:00 GMT'}</pubDate></item>`,
    )
    .join('')}</channel></rss>`
const paragraphs = (school: string) =>
  Array.from(
    { length: 5 },
    (_, i) =>
      `<p>Les élèves du ${school} ont bloqué l'entrée ce matin, paragraphe ${i + 1}, pour protester contre la réforme.</p>`,
  ).join('')
const page = (title: string, school: string) =>
  `<html lang="fr"><head><title>${title}</title></head><body><article>${paragraphs(school)}</article></body></html>`

interface World {
  feed: string
  pages: Record<string, string>
  /** What the model says for a text containing the key. */
  facts: Array<{ when: string; events: object[] }>
  down: boolean
  geminiCalls: number
  geminiDown: boolean
}
const world: World = {
  feed: '',
  pages: {},
  facts: [],
  down: false,
  geminiCalls: 0,
  geminiDown: false,
}

const fetchFn = async (url: string): Promise<Response> => {
  if (url === 'https://press.example/feed')
    return world.down ? new Response('', { status: 500 }) : new Response(world.feed)
  const html = world.pages[url]
  return html ? new Response(html) : new Response('', { status: 404 })
}

/** A Gemini that answers from `world.facts`, by looking at the items of the prompt. */
const geminiFetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  world.geminiCalls++
  if (world.geminiDown)
    return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 })
  const body = JSON.parse(String(init?.body)) as {
    contents: Array<{ parts: Array<{ text: string }> }>
  }
  const prompt = body.contents[0]?.parts[0]?.text ?? ''
  const items = JSON.parse(prompt.slice(prompt.indexOf('['))) as Array<{
    id: string
    texte: string
  }>
  const events = items.flatMap((item) =>
    world.facts
      .filter((f) => item.texte.includes(f.when))
      .flatMap((f) => f.events.map((e) => ({ item_id: item.id, ...e }))),
  )
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ events }) }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 },
    }),
  )
}

const event = (over: Record<string, unknown> = {}) => ({
  school_name: 'Lycée Pasteur',
  city: 'Lille',
  status: 'bloque',
  observed_at: null,
  certainty: 'haute',
  ...over,
})

const aiConfig = (over: Partial<AiConfig> = {}): AiConfig => ({
  ...DEFAULT_AI_CONFIG,
  credentials: { gemini: { apiKey: 'k' }, openaiCompatible: {} },
  tasks: {
    ...DEFAULT_AI_CONFIG.tasks,
    extract: {
      ...DEFAULT_AI_CONFIG.tasks.extract,
      models: [{ provider: 'gemini', model: 'gemini-3.5-flash-lite' }],
      retriesPerModel: 0,
    },
    judge: { kind: 'off' },
  },
  ...over,
})

let ingest: IngestService
let sourceId: string
const meter = createMeter()

async function build(ai: AiConfig = aiConfig()) {
  ingest = new IngestService(s.ctx, {
    fetchFn,
    now: () => NOW,
    ai: createAi(ai, { fetch: geminiFetch, sink: meter, sleep: async () => {} }),
    trigger: async () => {},
    config: { readerGateway: false },
  })
}

beforeEach(async () => {
  const db = s.ctx.db
  await db.delete(schema.reports)
  await db.delete(schema.unmatched)
  await db.delete(schema.ingestItems)
  await db.delete(schema.pipelineEvents)
  await db.delete(schema.sources)
  await db.delete(schema.trustedDomains)
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
  Object.assign(world, { down: false, geminiCalls: 0, geminiDown: false, facts: [], pages: {} })
  world.feed = rss([
    { guid: 'a1', title: 'Lycée Pasteur bloqué à Lille', link: 'https://press.example/pasteur' },
    { guid: 'a2', title: 'Recette de la tarte aux pommes', link: 'https://press.example/tarte' },
  ])
  world.pages['https://press.example/pasteur'] = page(
    'Lycée Pasteur bloqué à Lille',
    'lycée Pasteur de Lille',
  )
  world.facts = [{ when: 'lycée Pasteur', events: [event()] }]
  await build()
})

const states = async () => {
  const rows = await s.ctx.db.select().from(schema.ingestItems)
  return Object.fromEntries(rows.map((r) => [r.externalId, r.state]))
}
const allReports = () => s.ctx.db.select().from(schema.reports)

describe('the whole pipeline', () => {
  test('a feed item travels discover → read → extract → resolve and becomes a report in moderation', async () => {
    const found = await ingest.discover(sourceId, 'manual')
    expect(found).toMatchObject({ fetched: 2, newItems: 2, relevant: 1 })
    expect(await states()).toEqual({ a1: 'discovered', a2: 'irrelevant' })

    await ingest.drain()
    expect(await states()).toEqual({ a1: 'done', a2: 'irrelevant' })

    const [report] = await allReports()
    expect(report).toMatchObject({
      schoolUai: lille,
      status: 'blocked',
      origin: 'press',
      sourceUrl: 'https://press.example/pasteur',
      sourceDomain: 'press.example',
      // Not trusted, no second source: a human decides.
      moderation: 'pending',
      certainty: 'high',
      dateBasis: 'published',
      tier: 'unjudged',
    })
    const [extraction] = await s.ctx.db.select().from(schema.extractions)
    expect(extraction).toMatchObject({
      outcome: 'reported',
      schoolUai: lille,
      model: 'gemini-3.5-flash-lite',
      promptVersion: 'v1',
    })
    expect(extraction?.reportId).toBe(report?.id)
  })

  test('a trusted domain publishes without moderation, and the realtime bus is told', async () => {
    await s.ctx.db
      .insert(schema.trustedDomains)
      .values({ domain: 'press.example', label: 'Press', origin: 'press' })
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect((await allReports())[0]?.moderation).toBe('approved')
  })

  test('the article page is read: its text reaches the AI, and is kept apart from the item', async () => {
    await ingest.discover(sourceId, 'manual')
    await ingest.read()
    const [content] = await s.ctx.db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.strategy, 'article'))
    expect(content?.text).toContain('paragraphe 5')
    const [item] = await s.ctx.db
      .select()
      .from(schema.ingestItems)
      .where(eq(schema.ingestItems.externalId, 'a1'))
    expect(item?.state).toBe('read')
  })

  test('running again changes nothing: items are remembered, reports are not duplicated', async () => {
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    const again = await ingest.discover(sourceId, 'manual')
    expect(again.newItems).toBe(0)
    await ingest.drain()
    expect(await allReports()).toHaveLength(1)
    expect(world.geminiCalls).toBe(1)
  })

  test('every stage leaves events for the admin', async () => {
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    const events = await s.ctx.db.select().from(schema.pipelineEvents)
    const seen = new Set(events.map((e) => `${e.stage}:${e.outcome}`))
    for (const wanted of [
      'discover:ok',
      'relevance:irrelevant',
      'read:ok',
      'extract:extracted',
      'store:reported',
    ])
      expect(seen.has(wanted)).toBe(true)
    expect(events.find((e) => e.stage === 'read')?.itemId).toBeTruthy()
  })
})

describe('what is dropped, and why', () => {
  const outcomeOf = async () => (await s.ctx.db.select().from(schema.extractions))[0]

  test('low certainty', async () => {
    world.facts = [{ when: 'lycée Pasteur', events: [event({ certainty: 'faible' })] }]
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect(await outcomeOf()).toMatchObject({ outcome: 'low_certainty' })
    expect(await allReports()).toHaveLength(0)
  })

  test('a fact dated more than a week before the article is stale', async () => {
    world.facts = [{ when: 'lycée Pasteur', events: [event({ observed_at: '2026-09-20' })] }]
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect(await outcomeOf()).toMatchObject({ outcome: 'stale' })
  })

  test('a lycée "blocked" on a Saturday is not a blockade', async () => {
    world.feed = rss([
      {
        guid: 'a1',
        title: 'Lycée Pasteur bloqué à Lille',
        link: 'https://press.example/pasteur',
        pub: 'Sat, 10 Oct 2026 08:30:00 GMT',
      },
    ])
    await build()
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect(await outcomeOf()).toMatchObject({ outcome: 'weekend' })
  })

  test('a school the directory does not know waits in the staff queue, with an excerpt', async () => {
    world.facts = [
      {
        when: 'lycée Pasteur',
        events: [event({ school_name: 'Lycée Inconnu', city: 'Nullepart' })],
      },
    ]
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect(await outcomeOf()).toMatchObject({ outcome: 'unmatched' })
    const [row] = await s.ctx.db.select().from(schema.unmatched)
    expect(row).toMatchObject({
      schoolName: 'Lycée Inconnu',
      city: 'Nullepart',
      status: 'blocked',
      sourceUrl: 'https://press.example/pasteur',
    })
    expect(row?.context).toContain('paragraphe')
  })

  test('an article the AI finds nothing in is no_event, not a failure', async () => {
    world.facts = []
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect((await states()).a1).toBe('no_event')
  })

  test('the same fact from two sources is stored once; a second independent source approves both', async () => {
    const [second] = await s.ctx.db
      .insert(schema.sources)
      .values({
        kind: 'telegram',
        identifier: 'mobilycee',
        label: 'Mobilycee',
        origin: 'aggregator',
      })
      .returning({ id: schema.sources.id })
    // The first source reports it (pending, nobody confirms yet)…
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect((await allReports())[0]?.moderation).toBe('pending')
    // …then a post from another source says the same thing within the window.
    const post = {
      externalId: 'mobilycee/1',
      url: 'https://t.me/mobilycee/1',
      text: 'Blocus au lycée Pasteur à Lille ce matin',
      publishedAt: new Date('2026-10-07T09:00:00Z'),
    }
    world.facts.push({ when: 'Blocus au lycée Pasteur', events: [event()] })
    const telegram = new IngestService(s.ctx, {
      fetchFn: async () =>
        new Response(
          `<div class="tgme_widget_message" data-post="mobilycee/1"><div class="tgme_widget_message_text">${post.text}</div><div class="tgme_widget_message_date"><time datetime="${post.publishedAt.toISOString()}"></time></div></div>`,
        ),
      now: () => NOW,
      ai: ingest.deps.ai,
      trigger: async () => {},
    })
    await telegram.discover(second?.id ?? '', 'manual')
    await telegram.drain()
    const reports = await allReports()
    expect(reports).toHaveLength(2)
    expect(reports.map((r) => r.moderation)).toEqual(['approved', 'approved'])
  })
})

describe('merging the same article', () => {
  test('two feed items pointing at one article are analysed once', async () => {
    world.feed = rss([
      { guid: 'a1', title: 'Lycée Pasteur bloqué à Lille', link: 'https://press.example/pasteur' },
      {
        guid: 'a1-bis',
        title: 'Lycée Pasteur bloqué : le point',
        link: 'https://press.example/pasteur?utm_source=rss',
      },
    ])
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    const all = await s.ctx.db.select().from(schema.ingestItems)
    expect(all.map((i) => i.state).sort()).toEqual(['done', 'duplicate'])
    expect(all.find((i) => i.state === 'duplicate')?.mergedInto).toBe(
      all.find((i) => i.state === 'done')?.id,
    )
    expect(await allReports()).toHaveLength(1)
  })
})

describe('lanes', () => {
  test('an unreadable page and no feed text lands in the unreadable lane, and a retry re-reads it', async () => {
    world.feed = rss([{ guid: 'u1', title: 'Blocus', link: 'https://press.example/closed' }])
    world.pages = {} // the page answers 404
    await ingest.discover(sourceId, 'manual')
    await ingest.read()
    expect((await states()).u1).toBe('unreadable')
    world.pages['https://press.example/closed'] = page(
      'Blocus au lycée Pasteur',
      'lycée Pasteur de Lille',
    )
    expect(await ingest.retry()).toBe(1)
    await ingest.drain()
    expect((await states()).u1).toBe('done')
  })

  test('AI switched off: items wait in the deferred lane, and come back when it is on', async () => {
    await build(aiConfig({ enabled: false }))
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect(await states()).toMatchObject({ a1: 'deferred' })
    expect(world.geminiCalls).toBe(0)
    await build(aiConfig())
    await ingest.drain()
    expect((await states()).a1).toBe('done')
  })

  test('the daily budget defers too', async () => {
    await build(aiConfig({ budget: { dailyUsd: 0.5 } }))
    // Spend is read from the database: put today's spend over the cap.
    await s.ctx.db.insert(schema.aiUsage).values({
      hour: new Date(),
      task: 'extract',
      provider: 'gemini',
      model: 'm',
      promptVersion: 'v1',
      calls: 1,
      costUsd: '0.60',
    })
    await s.ctx.aiUsage.spentToday(true)
    await ingest.discover(sourceId, 'manual')
    await ingest.drain()
    expect((await states()).a1).toBe('deferred')
    const [item] = await s.ctx.db
      .select()
      .from(schema.ingestItems)
      .where(eq(schema.ingestItems.externalId, 'a1'))
    expect(item?.reason).toBe('ai:budget')
    await s.ctx.db.delete(schema.aiUsage)
    await s.ctx.aiUsage.spentToday(true)
  })

  test('an AI that keeps failing: attempts are counted, then the item goes to the failed lane', async () => {
    world.geminiDown = true
    await ingest.discover(sourceId, 'manual')
    for (let i = 0; i < 3; i++) await ingest.extract()
    // Before the item is read nothing was asked: read first.
    await ingest.read()
    for (let i = 0; i < 3; i++) await ingest.extract()
    expect((await states()).a1).toBe('failed')
    world.geminiDown = false
    expect(await ingest.retry()).toBe(1)
    await ingest.drain()
    expect((await states()).a1).toBe('done')
  })
})

describe('source health', () => {
  test('three failures pause the source; a scheduled read is skipped, a manual one goes through', async () => {
    world.down = true
    for (let i = 0; i < 3; i++)
      expect((await ingest.discover(sourceId, 'schedule')).error).toBeTruthy()
    let [source] = await s.ctx.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId))
    expect(source).toMatchObject({ health: 'open', consecutiveFailures: 3 })
    expect(source?.nextAttemptAt).toBeTruthy()
    expect(source?.lastError).toContain('500')
    expect(await ingest.dueSources()).not.toContain(sourceId)
    expect((await ingest.discover(sourceId, 'schedule')).skipped).toBe('breaker-open')

    world.down = false
    expect((await ingest.discover(sourceId, 'manual')).error).toBeUndefined()
    ;[source] = await s.ctx.db.select().from(schema.sources).where(eq(schema.sources.id, sourceId))
    expect(source).toMatchObject({ health: 'closed', consecutiveFailures: 0, lastError: null })
    const runs = await s.ctx.db.select().from(schema.sourceRuns)
    expect(runs.filter((r) => r.error)).toHaveLength(3)
  })

  test('a disabled source is not read on schedule', async () => {
    await s.ctx.db
      .update(schema.sources)
      .set({ enabled: false })
      .where(eq(schema.sources.id, sourceId))
    expect((await ingest.discover(sourceId, 'schedule')).skipped).toBe('disabled')
    expect(await ingest.dueSources()).toEqual([])
  })
})

describe('housekeeping', () => {
  test('article text, excerpts and old events are deleted after their retention', async () => {
    await ingest.discover(sourceId, 'manual')
    world.facts = [
      {
        when: 'lycée Pasteur',
        events: [event({ school_name: 'Lycée Inconnu', city: 'Nullepart' })],
      },
    ]
    await ingest.drain()
    const old = new Date(NOW.getTime() - 10 * 86_400_000)
    await s.ctx.db.update(schema.itemContents).set({ fetchedAt: old })
    await s.ctx.db.update(schema.unmatched).set({ createdAt: old })
    await s.ctx.db
      .update(schema.pipelineEvents)
      .set({ at: new Date(NOW.getTime() - 40 * 86_400_000) })
    const purged = await ingest.purge()
    expect(purged.contents).toBeGreaterThan(0)
    expect(purged.excerpts).toBe(1)
    expect(purged.events).toBeGreaterThan(0)
    expect((await s.ctx.db.select().from(schema.unmatched))[0]?.context).toBeNull()
    // The items themselves stay: they are the memory of what was seen.
    expect(await s.ctx.db.select().from(schema.ingestItems)).toHaveLength(2)
  })
})
