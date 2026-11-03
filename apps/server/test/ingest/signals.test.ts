import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createAi, createMeter } from '@manifeste/ai'
import { readSettings } from '@manifeste/core'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { IngestService } from '../../src/ingest/service.ts'
import { parisNoon } from '../../src/ingest/signals-stage.ts'
import { startTestServer, type TestServer } from '../helpers.ts'
import { NOW, aiConfig, fetchFn, geminiFetch, rss, world } from './world.ts'

let s: TestServer
beforeAll(async () => {
  s = await startTestServer()
})
afterAll(() => s.close())

let ingest: IngestService
let sourceId: string
let signalCalls = 0
let offered: Array<{ cle: string; nom?: string; description?: string | null }> = []

const A1 = 'https://press.example/rennes-agriculteurs'
const A2 = 'https://press.example/rennes-agriculteurs-bis'
const body = [
  '<p>Plusieurs centaines d’agriculteurs ont manifesté ce samedi à Rennes : le rassemblement s’est tenu rue de Nantes, devant le siège de la chambre d’agriculture, avant un cortège dans les rues du centre.</p>',
  '<p>Les manifestants dénoncent la hausse des charges et réclament une réponse du gouvernement. Les syndicats annoncent de nouvelles actions dans les prochains jours dans toute la Bretagne.</p>',
  '<p>La préfecture d’Ille-et-Vilaine a fait état d’une manifestation calme, sans incident, avec une circulation déviée autour de la place de la Mairie pendant la matinée.</p>',
].join('')
const page = (title: string) =>
  `<html lang="fr"><head><title>${title}</title></head><body><article>${body}</article></body></html>`

const signal = (over: Record<string, unknown> = {}) => ({
  city: 'Rennes',
  day: '2026-10-17',
  timing: 'en_cours',
  title: 'Manifestation des agriculteurs',
  mouvement: null,
  mouvement_quote: null,
  lieu: {
    name: 'rue de Nantes',
    niveau: 'rue',
    quote: 'le rassemblement s’est tenu rue de Nantes, devant le siège',
  },
  ...over,
})
const signalsAi = (...entries: object[]) => signalsAiBy(() => entries)
const signalsAiBy = (entriesFor: (index: number) => object[]) =>
  createAi(aiConfig(), {
    sleep: async () => {},
    fetch: async (_url, init) => {
      signalCalls++
      const prompt =
        (JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> })
          .contents[0]?.parts[0]?.text ?? ''
      const items = JSON.parse(
        prompt.slice(
          prompt.indexOf('Articles à analyser (JSON) :\n') +
            'Articles à analyser (JSON) :\n'.length,
        ),
      ) as Array<{ id: string }>
      offered = JSON.parse(
        prompt.slice(prompt.indexOf('['), prompt.indexOf('\n\nArticles')),
      ) as typeof offered
      const out = {
        articles: items.map((i) => ({ item_id: i.id, mobilisations: entriesFor(Number(i.id)) })),
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }),
      )
    },
  })

const square = (lng: number, lat: number, d: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ],
  ],
})
const geoFetch = async (url: string): Promise<Response> => {
  const u = new URL(url)
  if (u.hostname === 'geo.api.gouv.fr') {
    if (u.pathname.startsWith('/communes/35238'))
      return Response.json({ nom: 'Rennes', contour: square(-1.72, 48.08, 0.1) })
    return Response.json([
      { nom: 'Rennes', code: '35238', centre: { coordinates: [-1.6778, 48.1173] } },
    ])
  }
  if (u.hostname === 'api-adresse.data.gouv.fr') {
    const q = u.searchParams.get('q') ?? ''
    return Response.json({
      features: q.startsWith('rue de Nantes')
        ? [
            {
              geometry: { coordinates: [-1.7, 48.1] },
              properties: {
                label: 'Rue de Nantes 35000 Rennes',
                score: 0.9,
                type: 'street',
                citycode: '35238',
              },
            },
          ]
        : [],
    })
  }
  if (u.hostname.includes('nominatim'))
    return Response.json([
      {
        lat: '48.11',
        lon: '-1.68',
        display_name: 'Villejean, Rennes, Ille-et-Vilaine',
        geojson: square(-1.7, 48.1, 0.02),
      },
    ])
  return new Response('', { status: 404 })
}

const events = () => s.ctx.db.select().from(schema.movementEvents)

async function collect(on = true) {
  ingest.deps.settings = {
    all: async () => readSettings(on ? [{ key: 'signaled_mobilisations', value: true }] : []),
  }
  await ingest.discover(sourceId, 'manual')
  await ingest.read()
}

beforeEach(async () => {
  const db = s.ctx.db
  signalCalls = 0
  await db.delete(schema.movementEvents)
  await db.delete(schema.signalScans)
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
  Object.assign(world, { down: false, geminiCalls: 0, geminiDown: false, facts: [], pages: {} })
  world.feed = rss([
    { guid: 'a1', title: 'Agriculteurs : manifestation à Rennes ce samedi', link: A1 },
  ])
  world.pages[A1] = page('Agriculteurs : manifestation à Rennes')
  ingest = new IngestService(s.ctx, {
    fetchFn,
    now: () => NOW,
    ai: createAi(aiConfig(), { fetch: geminiFetch, sink: createMeter(), sleep: async () => {} }),
    trigger: async () => {},
    config: { readerGateway: false },
  })
})

describe('what is collected', () => {
  test('off: a demonstration that is not about a school is dropped as before', async () => {
    await collect(false)
    const [item] = await s.ctx.db.select().from(schema.ingestItems)
    expect(item).toMatchObject({ state: 'irrelevant', scope: 'school' })
  })

  test('on: it is kept in its own scope and the school extraction never sees it', async () => {
    await collect(true)
    const [item] = await s.ctx.db.select().from(schema.ingestItems)
    expect(item).toMatchObject({ scope: 'demonstration' })
    world.geminiCalls = 0
    await ingest.extract()
    expect(world.geminiCalls).toBe(0)
    expect(await ingest.media()).toMatchObject({ analysed: 0, calls: 0 })
  })
})

describe('signaled mobilisations', () => {
  test('off by default: no AI call, nothing stored', async () => {
    await collect(true)
    ingest.deps.ai = signalsAi(signal())
    ingest.deps.settings = { all: async () => readSettings([]) }
    expect(await ingest.signals()).toMatchObject({ scanned: 0, calls: 0, events: 0 })
    expect(signalCalls).toBe(0)
  })

  test('a street gives a point; the event is published, follows no movement and is never a blockade', async () => {
    await collect(true)
    ingest.deps.ai = signalsAi(signal())
    ingest.deps.fetchFn = geoFetch
    expect(await ingest.signals()).toMatchObject({ scanned: 1, calls: 1, events: 1 })
    const [e] = await events()
    expect(e).toMatchObject({
      kind: 'signaled',
      movementId: null,
      precision: 'point',
      citycode: '35238',
      moderation: 'approved',
      hidden: false,
      lng: -1.7,
      lat: 48.1,
      sourceUrl: A1,
    })
    expect(e?.zone).toBeNull()
    expect(e?.place).toBe('rue de Nantes, Rennes')
    // The article leaves the funnel.
    const [item] = await s.ctx.db.select().from(schema.ingestItems)
    expect(item).toMatchObject({ state: 'done' })
    // Read once, found or not.
    expect(await ingest.signals()).toMatchObject({ scanned: 0, calls: 0 })
    expect(signalCalls).toBe(1)
  })

  test('a district gives a red zone from its outline', async () => {
    await collect(true)
    ingest.deps.ai = signalsAi(
      signal({
        lieu: {
          name: 'quartier Centre',
          niveau: 'quartier',
          quote: 'des agriculteurs ont manifesté ce samedi à Rennes',
        },
      }),
    )
    ingest.deps.fetchFn = geoFetch
    // The quote must contain the name: the place falls back to the commune.
    await ingest.signals()
    const [e] = await events()
    expect(e?.precision).toBe('city')
    expect(e?.zone?.type).toBe('Polygon')
  })

  test('a district named in the text keeps its own zone', async () => {
    world.pages[A1] = page('Agriculteurs : manifestation à Rennes').replace(
      'dans les rues du centre',
      'dans le quartier Villejean',
    )
    await collect(true)
    ingest.deps.ai = signalsAi(
      signal({
        lieu: {
          name: 'quartier Villejean',
          niveau: 'quartier',
          quote: 'dans le quartier Villejean',
        },
      }),
    )
    ingest.deps.fetchFn = geoFetch
    await ingest.signals()
    const [e] = await events()
    expect(e).toMatchObject({ precision: 'district' })
    expect(e?.zone?.coordinates[0]).toHaveLength(5)
  })

  test('a street that cannot be found falls back to the whole commune, never to a guess', async () => {
    await collect(true)
    ingest.deps.ai = signalsAi(signal())
    ingest.deps.fetchFn = async (url) =>
      new URL(url).hostname.startsWith('api-adresse')
        ? Response.json({ features: [] })
        : new URL(url).hostname.includes('nominatim')
          ? Response.json([])
          : geoFetch(url)
    await ingest.signals()
    const [e] = await events()
    expect(e).toMatchObject({ precision: 'city', lng: -1.6778, lat: 48.1173 })
    expect(e?.zone).not.toBeNull()
  })

  test('the same mobilisation told by two outlets is one event', async () => {
    world.feed = rss([
      { guid: 'a1', title: 'Agriculteurs : manifestation à Rennes ce samedi', link: A1 },
      { guid: 'a2', title: 'Rennes : les agriculteurs manifestent (bis)', link: A2 },
    ])
    world.pages[A2] = world.pages[A1] ?? ''
    await collect(true)
    ingest.deps.ai = signalsAi(signal())
    ingest.deps.fetchFn = geoFetch
    const out = await ingest.signals()
    expect(out.scanned).toBe(2)
    expect(await events()).toHaveLength(1)
  })

  test('attached to an active movement only when the article names its cause', async () => {
    const [mv] = await s.ctx.db
      .insert(schema.movements)
      .values({ slug: 'agriculteurs', name: 'Agriculteurs', startsAt: NOW })
      .returning({ id: schema.movements.id })
    await s.ctx.db
      .insert(schema.movements)
      .values({ slug: 'old', name: 'Ancien', status: 'archived', startsAt: NOW, endsAt: NOW })
    try {
      await collect(true)
      ingest.deps.ai = signalsAi(
        signal({
          mouvement: 'm1',
          mouvement_quote: 'Les manifestants dénoncent la hausse des charges',
        }),
      )
      ingest.deps.fetchFn = geoFetch
      await ingest.signals()
      // Only the active movement was offered.
      expect(offered).toEqual([{ cle: 'm1', nom: 'Agriculteurs', description: null }])
      const [e] = await events()
      expect(e?.movementId).toBe(mv?.id ?? '')
    } finally {
      await s.ctx.db.delete(schema.movementEvents)
      await s.ctx.db.delete(schema.movements)
    }
  })

  test('a movement key that was not offered, or a quote not in the text, attaches nothing', async () => {
    await s.ctx.db
      .insert(schema.movements)
      .values({ slug: 'agriculteurs', name: 'Agriculteurs', startsAt: NOW })
    try {
      await collect(true)
      ingest.deps.ai = signalsAi(
        signal({
          mouvement: 'm9',
          mouvement_quote: 'Les manifestants dénoncent la hausse des charges',
        }),
      )
      ingest.deps.fetchFn = geoFetch
      await ingest.signals()
      expect((await events())[0]?.movementId).toBeNull()
      await s.ctx.db.delete(schema.movementEvents)
      await s.ctx.db.delete(schema.signalScans)
      ingest.deps.ai = signalsAi(signal({ mouvement: 'm1', mouvement_quote: 'phrase inventée' }))
      await ingest.signals()
      expect((await events())[0]?.movementId).toBeNull()
    } finally {
      await s.ctx.db.delete(schema.movementEvents)
      await s.ctx.db.delete(schema.movements)
    }
  })

  test('an event stored without a movement is attached when another article gives its cause, never moved', async () => {
    const [mv] = await s.ctx.db
      .insert(schema.movements)
      .values({ slug: 'agriculteurs', name: 'Agriculteurs', startsAt: NOW })
      .returning({ id: schema.movements.id })
    try {
      world.feed = rss([
        { guid: 'a1', title: 'Agriculteurs : manifestation à Rennes ce samedi', link: A1 },
        { guid: 'a2', title: 'Rennes : les agriculteurs manifestent (bis)', link: A2 },
      ])
      world.pages[A2] = world.pages[A1] ?? ''
      await collect(true)
      ingest.deps.fetchFn = geoFetch
      const cause = signal({
        mouvement: 'm1',
        mouvement_quote: 'Les manifestants dénoncent la hausse des charges',
      })
      // Which article is read first does not matter: only one of them names the cause.
      ingest.deps.ai = signalsAiBy((index) => [index === 0 ? signal() : cause])
      await ingest.signals()
      const all = await events()
      expect(all).toHaveLength(1)
      expect(all[0]?.movementId).toBe(mv?.id ?? '')
    } finally {
      await s.ctx.db.delete(schema.movementEvents)
      await s.ctx.db.delete(schema.movements)
    }
  })

  test('an unknown commune or an announced date that is missing places nothing', async () => {
    await collect(true)
    ingest.deps.ai = signalsAi(signal({ day: null, timing: 'annonce' }))
    ingest.deps.fetchFn = geoFetch
    await ingest.signals()
    expect(await events()).toHaveLength(0)
  })
})

describe('Paris time', () => {
  test('noon in Paris is 10:00 UTC in summer and 11:00 UTC in winter', () => {
    expect(parisNoon('2026-10-17').toISOString()).toBe('2026-10-17T10:00:00.000Z')
    expect(parisNoon('2026-12-05').toISOString()).toBe('2026-12-05T11:00:00.000Z')
  })
})

void eq
