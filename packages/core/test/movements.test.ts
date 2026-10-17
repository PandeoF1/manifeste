import { describe, expect, test } from 'bun:test'
import {
  eventStatusAt,
  MAX_ROUTE_POINTS,
  parseRoute,
  routeLengthMeters,
  slugify,
  SLUG_PATTERN,
} from '../src/movements.ts'

describe('slugify', () => {
  test('lowercase, no accents, dashes', () => {
    expect(slugify('Lycéens, automne 2026')).toBe('lyceens-automne-2026')
    expect(slugify('  Réforme des retraites !! ')).toBe('reforme-des-retraites')
  })
  test('always matches the slug pattern, and is bounded', () => {
    for (const title of ['À bas l’État', '2026', 'a'.repeat(200) + '-b']) {
      const slug = slugify(title)
      expect(slug).toMatch(SLUG_PATTERN)
      expect(slug.length).toBeLessThanOrEqual(80)
    }
  })
  test('nothing usable gives an empty slug (the caller must refuse it)', () => {
    expect(slugify('???')).toBe('')
  })
})

describe('parseRoute', () => {
  const ok = [
    [2.3488, 48.8534],
    [2.3522, 48.8566],
  ]
  test('accepts at least two valid [lng, lat] points', () => {
    expect(parseRoute(ok)).toEqual(ok as never)
  })
  test('rejects what is not a route', () => {
    for (const bad of [
      null,
      'x',
      [],
      [[2, 48]],
      [[2, 48], [3]],
      [
        [2, 48],
        ['3', 49],
      ],
      [
        [2, 48],
        [3, Number.NaN],
      ],
      [
        [2, 48],
        [200, 10],
      ],
      [
        [2, 48],
        [10, 95],
      ],
    ])
      expect(parseRoute(bad)).toBeNull()
  })
  test('rejects a route with too many points', () => {
    const big = Array.from({ length: MAX_ROUTE_POINTS + 1 }, (_, i) => [2 + i / 1e6, 48])
    expect(parseRoute(big)).toBeNull()
  })
})

describe('routeLengthMeters', () => {
  test('République to Nation is about 3 km', () => {
    const km =
      routeLengthMeters([
        [2.3637, 48.8675],
        [2.3959, 48.8483],
      ]) / 1000
    expect(km).toBeGreaterThan(2.5)
    expect(km).toBeLessThan(3.5)
  })
  test('zero for a single point or a repeated one', () => {
    expect(routeLengthMeters([[2, 48]])).toBe(0)
    expect(
      routeLengthMeters([
        [2, 48],
        [2, 48],
      ]),
    ).toBe(0)
  })
})

describe('eventStatusAt', () => {
  const startsAt = new Date('2026-10-17T14:00:00Z')
  const endsAt = new Date('2026-10-17T17:00:00Z')
  const at = (iso: string) => new Date(iso)
  test('planned, ongoing, ended by the dates', () => {
    const e = { status: 'planned' as const, startsAt, endsAt }
    expect(eventStatusAt(e, at('2026-10-17T13:59:00Z'))).toBe('planned')
    expect(eventStatusAt(e, at('2026-10-17T14:00:00Z'))).toBe('ongoing')
    expect(eventStatusAt(e, at('2026-10-17T16:59:00Z'))).toBe('ongoing')
    expect(eventStatusAt(e, at('2026-10-17T17:00:00Z'))).toBe('ended')
  })
  test('without an end date it is assumed to last 4 hours', () => {
    const e = { status: 'planned' as const, startsAt, endsAt: null }
    expect(eventStatusAt(e, at('2026-10-17T17:59:00Z'))).toBe('ongoing')
    expect(eventStatusAt(e, at('2026-10-17T18:00:00Z'))).toBe('ended')
  })
  test('cancelled and ended are final', () => {
    for (const status of ['cancelled', 'ended'] as const)
      expect(eventStatusAt({ status, startsAt, endsAt }, at('2026-10-17T15:00:00Z'))).toBe(status)
  })
})
