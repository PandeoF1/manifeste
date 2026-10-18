import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createAi, createMeter } from '@manifeste/ai'
import { readSettings } from '@manifeste/core'
import { schema } from '@manifeste/db'
import { plausibleDay } from '../../src/ingest/routes-stage.ts'
import { IngestService } from '../../src/ingest/service.ts'
import { startTestServer, type TestServer } from '../helpers.ts'
import { NOW, aiConfig, fetchFn, geminiFetch, page, rss, world } from './world.ts'

let s: TestServer
beforeAll(async () => {
  s = await startTestServer()
})
afterAll(() => s.close())

let ingest: IngestService
let sourceId: string
const ARTICLE = 'https://press.example/cortege-lille'
const body = [
  '<p>Les lycéens de Lille défileront mardi 13 octobre : le cortège partira de la place de la République à 14 heures, passera par la rue Nationale, puis rejoindra la Grand-Place.</p>',
  '<p>Le parcours a été communiqué à la préfecture ce lundi par les organisateurs, qui attendent plusieurs milliers de personnes.</p>',
  '<p>Plusieurs établissements de la métropole lilloise appellent à rejoindre le rassemblement dès la fin de la matinée, et un groupe ira à pied jusqu’à Roubaix.</p>',
].join('')
const march = {
  city: 'Lille',
  day: '2026-10-13',
  timing: 'annonce',
  title: 'Marche des lycéens',
  lyceens_etudiants_preuve: 'Les lycéens de Lille défileront mardi 13 octobre',
  places: [
    {
      name: 'place de la République',
      quote: 'le cortège partira de la place de la République à 14 heures',
    },
    { name: 'rue Nationale', quote: 'passera par la rue Nationale' },
    { name: 'Grand-Place', quote: 'rejoindra la Grand-Place' },
  ],
}
let routeCalls = 0

const routesAi = (marches: object[] = [march]) =>
  createAi(aiConfig(), {
    sleep: async () => {},
    fetch: async (_url, init) => {
      routeCalls++
      const prompt =
        (
          JSON.parse(String(init?.body)) as {
            contents: Array<{ parts: Array<{ text: string }> }>
          }
        ).contents[0]?.parts[0]?.text ?? ''
      const items = JSON.parse(prompt.slice(prompt.indexOf('['))) as Array<{ id: string }>
      const out = { articles: items.map((i) => ({ item_id: i.id, marches })) }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }),
      )
    },
  })

const GEO: Record<string, [number, number]> = {
  'place de la République': [3.0706, 50.6296],
  'rue Nationale': [3.0585, 50.6372],
  'Grand-Place': [3.0635, 50.6366],
}
const geoFetch = async (url: string): Promise<Response> => {
  const u = new URL(url)
  if (u.hostname === 'geo.api.gouv.fr')
    return Response.json(
      u.searchParams.get('nom') === 'Roubaix'
        ? [{ nom: 'Roubaix', code: '59512', centre: { coordinates: [3.17, 50.69] } }]
        : [{ nom: 'Lille', code: '59350', centre: { coordinates: [3.0573, 50.6292] } }],
    )
  if (u.hostname === 'api-adresse.data.gouv.fr') {
    const q = u.searchParams.get('q') ?? ''
    const hit = Object.entries(GEO).find(([name]) => q.startsWith(name))
    return Response.json({
      features: hit
        ? [
            {
              geometry: { coordinates: hit[1] },
              properties: {
                label: `${hit[0]} 59000 Lille`,
                score: 0.9,
                type: 'street',
                citycode: '59350',
              },
            },
          ]
        : [],
    })
  }
  if (u.hostname.includes('routing'))
    return Response.json({
      code: 'Ok',
      routes: [
        {
          distance: 1800,
          geometry: {
            coordinates: [
              [3.0706, 50.6296],
              [3.0585, 50.6372],
              [3.0635, 50.6366],
            ],
          },
        },
      ],
    })
  return Response.json([]) // Nominatim: nothing
}

beforeEach(async () => {
  const db = s.ctx.db
  routeCalls = 0
  await db.delete(schema.routeProposals)
  await db.delete(schema.routeScans)
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
    {
      guid: 'c1',
      title: 'Manifestation des lycéens : le parcours du cortège à Lille',
      link: ARTICLE,
    },
  ])
  world.pages[ARTICLE] =
    `<html lang="fr"><head><title>Manifestation des lycéens à Lille</title></head><body><article>${body}</article></body></html>`
  ingest = new IngestService(s.ctx, {
    fetchFn,
    now: () => NOW,
    ai: createAi(aiConfig(), { fetch: geminiFetch, sink: createMeter(), sleep: async () => {} }),
    trigger: async () => {},
    config: { readerGateway: false },
  })
  await ingest.discover(sourceId, 'manual')
  await ingest.read()
  ingest.deps.settings = {
    all: async () => readSettings([{ key: 'route_detection', value: true }]),
  }
})

const proposals = () => s.ctx.db.select().from(schema.routeProposals)

describe('route detection', () => {
  test('off by default: no AI call, nothing stored', async () => {
    ingest.deps.ai = routesAi()
    ingest.deps.settings = { all: async () => readSettings([]) }
    expect(await ingest.routes()).toMatchObject({ scanned: 0, calls: 0, proposals: 0 })
    expect(routeCalls).toBe(0)
  })

  test('a described route becomes a pending proposal with points, a line and no warnings', async () => {
    ingest.deps.ai = routesAi()
    ingest.deps.fetchFn = geoFetch
    expect(await ingest.routes()).toMatchObject({ scanned: 1, calls: 1, proposals: 1 })
    const [p] = await proposals()
    expect(p).toMatchObject({
      url: ARTICLE,
      city: 'Lille',
      citycode: '59350',
      day: '2026-10-13',
      timing: 'announced',
      status: 'pending',
      groupKey: '59350|2026-10-13',
      warnings: [],
    })
    expect(p?.places.map((x) => x.status)).toEqual(['ok', 'ok', 'ok'])
    expect(p?.line).toHaveLength(3)
    expect(p?.lineKm).toBe(1.8)
    // Nothing is public: no movement event was created.
    expect(await s.ctx.db.select().from(schema.movementEvents)).toHaveLength(0)
  })

  test('an article is read once, found or not', async () => {
    ingest.deps.ai = routesAi()
    ingest.deps.fetchFn = geoFetch
    await ingest.routes()
    expect(await ingest.routes()).toMatchObject({ scanned: 0, calls: 0 })
    expect(routeCalls).toBe(1)
  })

  test('a place the geocoder cannot find is flagged, and no line is drawn', async () => {
    ingest.deps.ai = routesAi()
    ingest.deps.fetchFn = async (url) =>
      new URL(url).searchParams.get('q')?.startsWith('rue Nationale')
        ? Response.json({ features: [] })
        : geoFetch(url)
    await ingest.routes()
    const [p] = await proposals()
    expect(p?.places.map((x) => x.status)).toEqual(['ok', 'none', 'ok'])
    expect(p?.warnings).toContain('Lieu introuvable : rue Nationale')
    expect(p?.line).toBeNull()
  })

  test('a route that cannot be computed is flagged and never replaced by a straight line', async () => {
    ingest.deps.ai = routesAi()
    ingest.deps.fetchFn = async (url) =>
      new URL(url).hostname.includes('routing') ? new Response('', { status: 500 }) : geoFetch(url)
    await ingest.routes()
    const [p] = await proposals()
    expect(p?.line).toBeNull()
    expect(p?.warnings).toContain('Le trajet à pied n’a pas pu être calculé')
  })

  test('an implausible walking route is kept for review but not drawn', async () => {
    ingest.deps.ai = routesAi()
    ingest.deps.fetchFn = async (url) =>
      new URL(url).hostname.includes('routing')
        ? Response.json({
            code: 'Ok',
            routes: [
              {
                distance: 33700,
                geometry: {
                  coordinates: [
                    [3, 50],
                    [3.1, 50.1],
                  ],
                },
              },
            ],
          })
        : geoFetch(url)
    await ingest.routes()
    const [p] = await proposals()
    expect(p?.line).toBeNull()
    expect(p?.warnings.some((w) => w.includes('très long'))).toBe(true)
  })

  test('an article that does not look like a march costs no AI call', async () => {
    await s.ctx.db.delete(schema.routeScans)
    world.pages[ARTICLE] = page('Blocus des lycéens à Lille', 'lycée Pasteur de Lille')
    await s.ctx.db.delete(schema.ingestItems)
    await ingest.discover(sourceId, 'manual')
    await ingest.read()
    ingest.deps.ai = routesAi([])
    ingest.deps.fetchFn = geoFetch
    const r = await ingest.routes()
    expect(r).toMatchObject({ calls: 0, skipped: 1 })
    expect(routeCalls).toBe(0)
  })
})

describe('a march that is a trip between towns', () => {
  test('a place that is another commune is refused, flagged, and no line is drawn', async () => {
    const trip = {
      ...march,
      places: [
        {
          name: 'place de la République',
          quote: 'le cortège partira de la place de la République à 14 heures',
        },
        { name: 'Roubaix', quote: 'un groupe ira à pied jusqu’à Roubaix' },
      ],
    }
    ingest.deps.ai = routesAi([trip])
    ingest.deps.fetchFn = geoFetch
    await ingest.routes()
    const [p] = await proposals()
    expect(p?.places.map((x) => x.status)).toEqual(['ok', 'none'])
    expect(p?.warnings.some((w) => w.includes('autre commune'))).toBe(true)
    expect(p?.line).toBeNull()
  })
})

describe('the same dispatch printed twice', () => {
  test('one proposal for the same march told by two outlets; another route stays', async () => {
    ingest.deps.ai = routesAi()
    ingest.deps.fetchFn = geoFetch
    world.feed = rss([
      {
        guid: 'c1',
        title: 'Manifestation des lycéens : le parcours du cortège à Lille',
        link: ARTICLE,
      },
      {
        guid: 'c3',
        title: 'Manifestation des lycéens : le parcours à Lille (bis)',
        link: `${ARTICLE}-bis`,
      },
    ])
    world.pages[`${ARTICLE}-bis`] = world.pages[ARTICLE] ?? ''
    await ingest.discover(sourceId, 'manual')
    await ingest.read()
    const out = await ingest.routes()
    expect(out.calls).toBe(1)
    expect(await proposals()).toHaveLength(1)
    // Both articles are marked as read, so neither is analysed again.
    expect(await ingest.routes()).toMatchObject({ scanned: 0, calls: 0 })
  })
})

describe('the day of a march', () => {
  const published = new Date('2026-10-15T08:00:00Z')
  test('a day close to the article is plausible; 1986, 2020 and next year are not', () => {
    expect(plausibleDay('2026-10-15', published)).toBe(true)
    expect(plausibleDay('2026-10-17', published)).toBe(true)
    expect(plausibleDay('2026-10-06', published)).toBe(true)
    expect(plausibleDay('2020-10-08', published)).toBe(false)
    expect(plausibleDay('1986-12-04', published)).toBe(false)
    expect(plausibleDay('2027-10-15', published)).toBe(false)
    expect(plausibleDay(null, published)).toBe(false)
  })
})
