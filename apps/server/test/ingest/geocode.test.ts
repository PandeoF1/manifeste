import { describe, expect, test } from 'bun:test'
import { coverage, distinctive, Geocoder } from '../../src/ingest/geocode.ts'
import { routeWarnings, walkingRoute, type WalkingRoute } from '../../src/ingest/osrm.ts'

const MONTPELLIER = {
  name: 'Montpellier',
  code: '34172',
  lng: 3.8767,
  lat: 43.6108,
  homonyms: [],
}

const ban = (label: string, lng: number, lat: number, score = 0.9, citycode = '34172') => ({
  features: [
    {
      geometry: { coordinates: [lng, lat] },
      properties: { label, score, type: 'street', citycode },
    },
  ],
})
const reply = (body: unknown) => new Response(JSON.stringify(body))

describe('words that prove a place', () => {
  test('generic words prove nothing', () => {
    expect(distinctive('la gare')).toEqual([])
    expect(distinctive('place de la Comédie')).toEqual(['comedie'])
    expect(coverage('place de la Comédie', 'Place de la Comédie 34000 Montpellier')).toBe(1)
    expect(coverage('gare', 'Avenue du Marché Gare')).toBe(0)
  })
})

describe('finding the commune', () => {
  const rows = (...names: string[]) =>
    names.map((nom, i) => ({ nom, code: `0${i}`, centre: { coordinates: [3 + i, 43] } }))

  test('takes the commune of that exact name, not a near one', async () => {
    const g = new Geocoder(async () => reply(rows('Tournai-sur-Dive')))
    expect(await g.commune('Tournai')).toBeNull()
    const l = new Geocoder(async () => reply(rows('Le Liège')))
    expect(await l.commune('Liège')).toBeNull()
    const ok = new Geocoder(async () => reply(rows('Lyonnais', 'Lyon')))
    expect((await ok.commune('Lyon'))?.name).toBe('Lyon')
  })

  test('says when other communes have the very same name', async () => {
    const g = new Geocoder(async () =>
      reply([
        {
          nom: 'Clermont',
          code: '60175',
          codeDepartement: '60',
          centre: { coordinates: [2.4, 49.4] },
        },
        {
          nom: 'Clermont',
          code: '09100',
          codeDepartement: '09',
          centre: { coordinates: [1.2, 43.2] },
        },
      ]),
    )
    const c = await g.commune('Clermont')
    expect(c?.code).toBe('60175')
    expect(c?.homonyms).toEqual(['09'])
  })

  test('a place that is the name of another commune is a trip between towns', async () => {
    const brest = (nom: string, code: string) =>
      reply([{ nom, code, codeDepartement: '29', centre: { coordinates: [-4.4, 48.4] } }])
    const g = new Geocoder(async () => brest('Brest', '29019'))
    const morlaix = { ...MONTPELLIER, name: 'Morlaix', code: '29151' }
    expect(await g.isOtherCommune('Brest', morlaix)).toBe(true)
    // Its own commune, or a named place, is not.
    expect(await g.isOtherCommune('Brest', { ...morlaix, code: '29019' })).toBe(false)
    expect(await g.isOtherCommune('place de la Comédie', morlaix)).toBe(false)
    expect(await g.isOtherCommune('gare', morlaix)).toBe(false)
  })

  test('ignores accents, hyphens and Saint / St', async () => {
    const g = new Geocoder(async () => reply(rows('Saint-Étienne')))
    expect((await g.commune('St Etienne'))?.name).toBe('Saint-Étienne')
  })
})

describe('geocoding a place', () => {
  test('a street found in the right commune with its words is ok', async () => {
    const g = new Geocoder(async () =>
      reply(ban('Boulevard du Jeu de Paume 34000 Montpellier', 3.87, 43.61)),
    )
    const p = await g.place('boulevard du Jeu-de-Paume', MONTPELLIER)
    expect(p).toMatchObject({ status: 'ok', lng: 3.87, lat: 43.61 })
  })

  test('"gare" matched to a street named Gare is not accepted, and stays a guess', async () => {
    const urls: string[] = []
    const g = new Geocoder(
      async (url) => {
        urls.push(url)
        return url.includes('nominatim')
          ? reply([])
          : reply(ban('Avenue du Marché Gare 34000 Montpellier', 3.88, 43.6, 0.71))
      },
      { sleep: async () => {} },
    )
    const p = await g.place('gare', MONTPELLIER)
    expect(p.status).toBe('weak')
    expect(urls.some((u) => u.includes('nominatim'))).toBe(true)
  })

  test('a place of interest missing from the address base comes from OpenStreetMap', async () => {
    const g = new Geocoder(
      async (url) =>
        url.includes('nominatim')
          ? reply([
              {
                lat: '43.6049',
                lon: '3.8808',
                display_name: 'Gare de Montpellier-Saint-Roch, Montpellier',
              },
            ])
          : reply({ features: [] }),
      { sleep: async () => {} },
    )
    const p = await g.place('gare Saint-Roch', MONTPELLIER)
    expect(p).toMatchObject({ status: 'ok', lat: 43.6049 })
    expect(p.label).toContain('OSM')
  })

  test('a result in another commune or far from the centre is refused', async () => {
    const other = new Geocoder(
      async (url) =>
        url.includes('nominatim')
          ? reply([])
          : reply(ban('Place de la Comédie 69001 Lyon', 4.83, 45.76, 0.9, '69123')),
      { sleep: async () => {} },
    )
    expect((await other.place('place de la Comédie', MONTPELLIER)).status).toBe('none')
    const far = new Geocoder(
      async (url) =>
        url.includes('nominatim')
          ? reply([])
          : reply(ban('Place de la Comédie 34000 Montpellier', 4.5, 44, 0.9)),
      { sleep: async () => {} },
    )
    expect((await far.place('place de la Comédie', MONTPELLIER)).status).toBe('none')
  })

  test('an unreachable service gives none, never a made-up point', async () => {
    const g = new Geocoder(
      async () => {
        throw new Error('down')
      },
      { sleep: async () => {} },
    )
    expect(await g.place('rue Foch', MONTPELLIER)).toMatchObject({ status: 'none', lat: null })
    expect(await g.commune('Montpellier')).toBeNull()
  })

  test('the same place is asked once', async () => {
    let calls = 0
    const g = new Geocoder(async () => {
      calls++
      return reply(ban('Rue Foch 34000 Montpellier', 3.87, 43.61))
    })
    await Promise.all([g.place('rue Foch', MONTPELLIER), g.place('Rue Foch', MONTPELLIER)])
    expect(calls).toBe(1)
  })
})

describe('walking route', () => {
  const osrm = (distance: number) =>
    reply({
      code: 'Ok',
      routes: [
        {
          distance,
          geometry: {
            coordinates: [
              [3.87, 43.61],
              [3.88, 43.6],
            ],
          },
        },
      ],
    })

  test('returns the line, length and detour', async () => {
    const r = await walkingRoute(
      async () => osrm(1500),
      [
        [3.87, 43.61],
        [3.88, 43.6],
      ],
    )
    expect(r?.km).toBe(1.5)
    expect(r?.line).toHaveLength(2)
    expect(r?.detour).toBeGreaterThan(1)
  })

  test('no route means null, never a straight line', async () => {
    expect(
      await walkingRoute(
        async () => new Response('', { status: 500 }),
        [
          [3.87, 43.61],
          [3.88, 43.6],
        ],
      ),
    ).toBeNull()
    expect(
      await walkingRoute(
        async () => reply({ code: 'NoRoute' }),
        [
          [3.87, 43.61],
          [3.88, 43.6],
        ],
      ),
    ).toBeNull()
    expect(
      await walkingRoute(async () => {
        throw new Error('x')
      }, [
        [3.87, 43.61],
        [3.88, 43.6],
      ]),
    ).toBeNull()
  })

  test('warns on implausible routes', () => {
    const route = (km: number, detour: number): WalkingRoute => ({ line: [], km, detour })
    expect(routeWarnings(route(3, 1.4), true)).toEqual([])
    expect(routeWarnings(route(33.7, 2), true)[0]).toContain('très long')
    expect(routeWarnings(route(3, 5), true)[0]).toContain('tortueux')
    expect(routeWarnings(null, true)).toHaveLength(1)
    expect(routeWarnings(null, false)).toEqual([])
  })
})

describe('zones', () => {
  const square = (lng: number, lat: number, s: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + s, lat],
        [lng + s, lat + s],
        [lng, lat + s],
        [lng, lat],
      ],
    ],
  })

  test('a commune is drawn with its outline from the official service', async () => {
    const g = new Geocoder(async () =>
      reply({ nom: 'Montpellier', contour: square(3.8, 43.6, 0.1) }),
    )
    const z = await g.zone('city', 'Montpellier', MONTPELLIER)
    expect(z?.zone.coordinates[0]).toHaveLength(5)
    expect(z?.label).toBe('Montpellier')
  })

  test('without an outline, a circle around the centre, labelled approximate', async () => {
    const g = new Geocoder(async () => new Response('', { status: 500 }))
    const z = await g.zone('city', 'Montpellier', MONTPELLIER)
    expect(z?.label).toContain('approximative')
    expect(z?.zone.coordinates[0]?.length).toBeGreaterThan(10)
  })

  test('an arrondissement comes from OpenStreetMap, spelled the way it spells it', async () => {
    const urls: string[] = []
    const paris = { ...MONTPELLIER, name: 'Paris', code: '75056', lng: 2.35, lat: 48.85 }
    const g = new Geocoder(
      async (url) => {
        urls.push(url)
        return reply([
          {
            lat: '48.83',
            lon: '2.36',
            display_name: 'Paris 13e Arrondissement, Paris, Île-de-France',
            geojson: square(2.34, 48.82, 0.03),
          },
        ])
      },
      { sleep: async () => {} },
    )
    const z = await g.zone('district', '13ème arrondissement', paris)
    expect(decodeURIComponent(urls[0] ?? '')).toContain('13e arrondissement, Paris')
    expect(z?.zone.coordinates[0]).toHaveLength(5)
  })

  test('a point instead of an outline becomes a circle; another place or nothing gives null', async () => {
    const point = new Geocoder(
      async () =>
        reply([
          {
            lat: '43.62',
            lon: '3.87',
            display_name: 'Les Arceaux, Montpellier',
            geojson: { type: 'Point', coordinates: [3.87, 43.62] },
          },
        ]),
      { sleep: async () => {} },
    )
    const z = await point.zone('neighbourhood', 'Les Arceaux', MONTPELLIER)
    expect(z?.zone.type).toBe('Polygon')
    const elsewhere = new Geocoder(
      async () => reply([{ lat: '45.7', lon: '4.8', display_name: 'Les Arceaux, Lyon' }]),
      { sleep: async () => {} },
    )
    expect(await elsewhere.zone('neighbourhood', 'Les Arceaux', MONTPELLIER)).toBeNull()
    const none = new Geocoder(async () => reply([]), { sleep: async () => {} })
    expect(await none.zone('neighbourhood', 'Les Arceaux', MONTPELLIER)).toBeNull()
  })
})
