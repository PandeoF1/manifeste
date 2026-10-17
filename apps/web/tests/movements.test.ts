import { describe, expect, it } from 'bun:test'
import {
  boundsOf,
  groupByDay,
  pointsGeoJSON,
  routeLengthLabel,
  routesGeoJSON,
  startOf,
  type MovementEvent,
} from '../src/lib/movements'

const event = (over: Partial<MovementEvent> = {}): MovementEvent => ({
  id: 'e1',
  kind: 'march',
  title: 'Cortège',
  place: null,
  status: 'planned',
  startsAt: new Date('2026-10-17T14:00:00Z'),
  endsAt: new Date('2026-10-17T17:00:00Z'),
  lat: null,
  lng: null,
  route: null,
  routeBasis: null,
  sourceUrl: null,
  sourceDomain: null,
  ...over,
})

const ROUTE: Array<[number, number]> = [
  [2.3637, 48.8675],
  [2.3959, 48.8483],
]

describe('routesGeoJSON', () => {
  it('draws only events with a route and says how reliable it is', () => {
    const fc = routesGeoJSON(
      [
        event({ id: 'a', route: ROUTE, routeBasis: 'announced' }),
        event({ id: 'b', route: ROUTE, routeBasis: 'probable' }),
        event({ id: 'c' }),
      ],
      new Date('2026-10-17T15:00:00Z'),
    )
    expect(fc.features.map((f) => [f.properties.id, f.properties.basis])).toEqual([
      ['a', 'announced'],
      ['b', 'probable'],
    ])
    expect(fc.features[0]?.geometry.coordinates).toEqual(ROUTE)
  })

  it('never draws a route that has no basis, or a single point', () => {
    const fc = routesGeoJSON(
      [
        event({ id: 'a', route: ROUTE, routeBasis: null }),
        event({ id: 'b', route: [[2, 48]], routeBasis: 'announced' }),
      ],
      new Date(),
    )
    expect(fc.features).toEqual([])
  })

  it('colours by the status shown now, not the stored one', () => {
    const e = event({ id: 'a', route: ROUTE, routeBasis: 'announced' })
    const before = routesGeoJSON([e], new Date('2026-10-17T12:00:00Z')).features[0]
    const during = routesGeoJSON([e], new Date('2026-10-17T15:00:00Z')).features[0]
    const after = routesGeoJSON([e], new Date('2026-10-17T20:00:00Z')).features[0]
    expect([before, during, after].map((f) => f?.properties.status)).toEqual([
      'planned',
      'ongoing',
      'ended',
    ])
  })
})

describe('points and bounds', () => {
  it('an event gathers at its position, else at the start of its route', () => {
    expect(startOf(event({ lat: 48.8, lng: 2.3 }))).toEqual([2.3, 48.8])
    expect(startOf(event({ route: ROUTE, routeBasis: 'announced' }))).toEqual(ROUTE[0] as never)
    expect(startOf(event())).toBeNull()
    expect(pointsGeoJSON([event()], new Date()).features).toEqual([])
  })

  it('bounds cover positions and routes, or nothing', () => {
    expect(boundsOf([])).toBeNull()
    expect(boundsOf([event()])).toBeNull()
    expect(
      boundsOf([event({ route: ROUTE, routeBasis: 'announced' }), event({ lat: 50, lng: 3 })]),
    ).toEqual([2.3637, 48.8483, 3, 50])
  })
})

describe('labels and groups', () => {
  it('route length in metres or kilometres', () => {
    expect(routeLengthLabel(event())).toBeNull()
    expect(routeLengthLabel(event({ route: ROUTE, routeBasis: 'announced' }))).toMatch(/^\d,\d km$/)
    expect(
      routeLengthLabel(
        event({
          route: [
            [2, 48],
            [2.0005, 48],
          ],
          routeBasis: 'announced',
        }),
      ),
    ).toMatch(/^\d+ m$/)
  })

  it('groups by day, keeping the order', () => {
    const day = (d: Date) => d.toISOString().slice(0, 10)
    const groups = groupByDay(
      [
        event({ id: 'a', startsAt: new Date('2026-10-17T09:00:00Z') }),
        event({ id: 'b', startsAt: new Date('2026-10-17T16:00:00Z') }),
        event({ id: 'c', startsAt: new Date('2026-10-18T10:00:00Z') }),
      ],
      day,
    )
    expect(groups.map((g) => [g.day, g.events.map((e) => e.id)])).toEqual([
      ['2026-10-17', ['a', 'b']],
      ['2026-10-18', ['c']],
    ])
  })
})
