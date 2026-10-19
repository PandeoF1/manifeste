import { describe, expect, test } from 'bun:test'
import { circleZone, MAX_ZONE_POINTS, parseZone, zoneFromGeometry } from '../src/index.ts'

describe('zones', () => {
  test('a circle is a closed ring around its centre', () => {
    const z = circleZone(2.35, 48.83, 600)
    const ring = z.coordinates[0] ?? []
    expect(ring[0]).toEqual(ring.at(-1))
    expect(parseZone(z)).not.toBeNull()
    // About 600 m from the centre, whatever the direction.
    const [lng, lat] = ring[0] as [number, number]
    const km = Math.hypot(
      (lng - 2.35) * 111.32 * Math.cos((48.83 * Math.PI) / 180),
      (lat - 48.83) * 111.32,
    )
    expect(km * 1000).toBeGreaterThan(550)
    expect(km * 1000).toBeLessThan(650)
  })

  test('refuses what is not a valid polygon', () => {
    expect(parseZone(null)).toBeNull()
    expect(parseZone({ type: 'Point', coordinates: [1, 2] })).toBeNull()
    expect(
      parseZone({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      }),
    ).toBeNull()
    expect(
      parseZone({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [200, 5],
            [0, 0],
          ],
        ],
      }),
    ).toBeNull()
  })

  test('keeps the largest polygon of a MultiPolygon and simplifies a heavy ring under the cap', () => {
    const big: Array<[number, number]> = []
    for (let i = 0; i < 2000; i++) {
      const a = (2 * Math.PI * i) / 2000
      big.push([+(2.3 + 0.05 * Math.cos(a)).toFixed(6), +(48.8 + 0.05 * Math.sin(a)).toFixed(6)])
    }
    big.push(big[0] as [number, number])
    const small = [
      [10, 10],
      [10.001, 10],
      [10.001, 10.001],
      [10, 10],
    ]
    const z = zoneFromGeometry({ type: 'MultiPolygon', coordinates: [[small], [big]] })
    expect(z).not.toBeNull()
    const ring = z?.coordinates[0] ?? []
    expect(ring.length).toBeLessThanOrEqual(MAX_ZONE_POINTS)
    expect(ring.length).toBeGreaterThan(20)
    expect(ring[0]?.[0]).toBeLessThan(3)
  })

  test('a geometry that is not an area gives nothing', () => {
    expect(zoneFromGeometry({ type: 'Point', coordinates: [1, 2] })).toBeNull()
    expect(zoneFromGeometry(null)).toBeNull()
  })
})
