import { describe, expect, it } from 'bun:test'
import {
  advance,
  bucketSize,
  bucketize,
  fmtAgo,
  fmtMoment,
  fmtTick,
  hourChoices,
  mobilisationAt,
  parseTimeline,
  rangeStart,
  statusesAt,
  type TimelineData,
} from '../src/lib/timeline'

const H = 3_600_000
const t0 = Date.parse('2026-10-05T10:00:00Z')

const school = (uai: string, department = '75') => ({
  uai,
  name: `Lycée ${uai}`,
  city: 'Paris',
  department,
  academy: 'Paris',
  lat: 48.85,
  lng: 2.35,
  level: 'lycee' as const,
})

const data: TimelineData = {
  schools: [school('A'), school('B', '31')],
  events: [
    { u: 'A', s: 'bloque', t: t0, k: 'dom:presse' },
    { u: 'B', s: 'filtrant', t: t0 + 1 * H, k: 'dom:x' },
    { u: 'A', s: 'bloque', t: t0 + 2 * H, k: 'src:1' },
    { u: 'A', s: 'leve', t: t0 + 3 * H, k: 'dom:presse' },
    { u: 'B', s: 'bloque', t: t0 + 8 * H, k: 'dom:x' },
  ],
}

describe('statusesAt', () => {
  it('nothing before the first report', () => {
    expect(statusesAt(data, t0 - 1, 5)).toEqual([])
  })

  it('status = latest report of the window, most recent first', () => {
    const rows = statusesAt(data, t0 + 1.5 * H, 5)
    expect(rows.map((r) => [r.uai, r.status])).toEqual([
      ['B', 'filtrant'],
      ['A', 'bloque'],
    ])
  })

  it('a lifted school stays shown as lifted', () => {
    const rows = statusesAt(data, t0 + 4 * H, 5)
    expect(rows.find((r) => r.uai === 'A')?.status).toBe('leve')
  })

  it('counts the distinct sources of the window', () => {
    const rows = statusesAt(data, t0 + 2.5 * H, 5)
    expect(rows.find((r) => r.uai === 'A')?.source_count).toBe(2)
    expect(rows.find((r) => r.uai === 'B')?.source_count).toBe(1)
  })

  it('a report leaves the window after `hours`', () => {
    // A: latest signal at +3 h; with 5 h it falls strictly after +8 h.
    expect(statusesAt(data, t0 + 7.9 * H, 5).some((r) => r.uai === 'A')).toBe(true)
    expect(statusesAt(data, t0 + 8 * H, 5).some((r) => r.uai === 'A')).toBe(false)
  })

  it('a longer window keeps older signals', () => {
    const rows = statusesAt(data, t0 + 9 * H, 24)
    expect(rows.map((r) => r.uai).sort()).toEqual(['A', 'B'])
    expect(rows.find((r) => r.uai === 'B')?.status).toBe('bloque')
  })

  it('never looks at the future', () => {
    const rows = statusesAt(data, t0 + 0.5 * H, 5)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.last_signal_at).toBe(new Date(t0).toISOString())
  })

  it('ignores a report whose school is unknown', () => {
    const odd: TimelineData = { schools: [], events: [{ u: 'Z', s: 'bloque', t: t0, k: 'k' }] }
    expect(statusesAt(odd, t0 + H, 5)).toEqual([])
  })
})

describe('parseTimeline', () => {
  it('accepts the database response and sorts the events', () => {
    const parsed = parseTimeline({
      schools: [school('A')],
      events: [
        { u: 'A', s: 'leve', t: 2000, k: 'k' },
        { u: 'A', s: 'bloque', t: 1000, k: 'k' },
      ],
    })
    expect(parsed.events.map((e) => e.t)).toEqual([1000, 2000])
  })

  it('ignores invalid rows without losing the others', () => {
    const parsed = parseTimeline({
      schools: [school('A'), { uai: 'B', name: null }],
      events: [
        { u: 'A', s: 'autre', t: 1, k: 'k' },
        { u: 'A', s: 'bloque', t: 2, k: 'k' },
      ],
    })
    expect(parsed.schools.map((s) => s.uai)).toEqual(['A'])
    expect(parsed.events).toHaveLength(1)
  })

  it('accepts a report without a source (on-site report)', () => {
    const parsed = parseTimeline({
      schools: [school('A')],
      events: [{ u: 'A', s: 'bloque', t: 1, k: null }],
    })
    expect(parsed.events).toHaveLength(1)
    expect(statusesAt(parsed, 2, 5)[0]?.source_count).toBe(0)
  })

  it('rejects a response with the wrong shape', () => {
    expect(() => parseTimeline([])).toThrow()
    expect(() => parseTimeline({ schools: [] })).toThrow()
  })
})

describe('bucketize', () => {
  it('buckets reports by slot and status', () => {
    const buckets = bucketize(data.events, t0, t0 + 4 * H, H)
    expect(buckets).toHaveLength(4)
    expect(buckets.map((b) => b.total)).toEqual([1, 1, 1, 1])
    expect(buckets[1]).toMatchObject({ filtrant: 1, bloque: 0 })
    expect(buckets[3]).toMatchObject({ leve: 1 })
  })

  it('ignores what is outside the window', () => {
    const buckets = bucketize(data.events, t0 + 4 * H, t0 + 6 * H, H)
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(0)
  })

  it('a report exactly at the end falls in the last slot', () => {
    const buckets = bucketize(data.events, t0 + 5 * H, t0 + 8 * H, H)
    expect(buckets[buckets.length - 1]?.bloque).toBe(1)
  })
})

describe('bucketSize', () => {
  it('gives round bars, at most ~96', () => {
    expect(bucketSize(24 * H)).toBe(15 * 60_000)
    expect(bucketSize(7 * 24 * H)).toBe(2 * H)
    expect(bucketSize(30 * 24 * H)).toBe(12 * H)
  })
})

describe('rangeStart', () => {
  const settings = { statusTtlHours: 5, movementStart: '2026-09-14', judgeTiers: false }
  const now = Date.parse('2026-10-05T12:00:00Z')
  it('goes back by the chosen duration', () => {
    expect(new Date(rangeStart('24h', settings, now)).toISOString()).toBe(
      '2026-10-04T12:00:00.000Z',
    )
    expect(new Date(rangeStart('3j', settings, now)).toISOString()).toBe('2026-10-02T12:00:00.000Z')
  })
  it('never before the start of the movement', () => {
    const early = Date.parse('2026-09-15T12:00:00Z')
    expect(new Date(rangeStart('7j', settings, early)).toISOString()).toBe(
      '2026-09-13T22:00:00.000Z',
    )
    expect(new Date(rangeStart('tout', settings, now)).toISOString()).toBe(
      '2026-09-13T22:00:00.000Z',
    )
  })
})

describe('advance', () => {
  it('runs through the whole timeline in 30 s at speed 1', () => {
    expect(advance(0, 30_000, 0, 3000, 1)).toBe(3000)
    expect(advance(0, 15_000, 0, 3000, 1)).toBe(1500)
    expect(advance(0, 15_000, 0, 3000, 2)).toBe(3000)
  })
  it('stays within bounds', () => {
    expect(advance(2900, 10_000, 0, 3000, 4)).toBe(3000)
    expect(advance(10, -10_000, 0, 3000, 1)).toBe(0)
  })
})

describe('hourChoices', () => {
  it('adds the site setting without duplicates, sorted', () => {
    expect(hourChoices(5)).toEqual([1, 3, 5, 6, 12, 24, 48])
    expect(hourChoices(12)).toEqual([1, 3, 6, 12, 24, 48])
  })
  it('keeps the value of a shared link even outside the list', () => {
    expect(hourChoices(5, 8)).toEqual([1, 3, 5, 6, 8, 12, 24, 48])
  })
})

describe('formats', () => {
  it('Paris time', () => {
    expect(fmtMoment(Date.parse('2026-10-08T12:30:00Z'))).toBe('jeu. 8 oct. · 14 h 30')
  })
  it('midnight stays 00 h', () => {
    expect(fmtMoment(Date.parse('2026-10-07T22:05:00Z'))).toContain('00 h 05')
  })
  it('ticks: hour over 24 h, day over 7 days', () => {
    const ms = Date.parse('2026-10-08T12:00:00Z')
    expect(fmtTick(ms, 24 * H)).toBe('8 oct. 14 h')
    expect(fmtTick(ms, 7 * 24 * H)).toBe('8 oct.')
  })
  it('elapsed time (il y a…)', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    expect(fmtAgo(now - 30_000, now)).toBe("à l'instant")
    expect(fmtAgo(now - 12 * 60_000, now)).toBe('il y a 12 min')
    expect(fmtAgo(now - 3 * H, now)).toBe('il y a 3 h')
    expect(fmtAgo(now - 72 * H, now)).toBe('il y a 3 j')
  })
})

describe('mobilisationAt', () => {
  const withMob: TimelineData = {
    schools: [school('A'), school('B', '31'), school('C')],
    events: [
      { u: 'A', s: 'bloque', t: t0, k: null },
      { u: 'A', s: 'bloque', t: t0 + H, k: null, m: true },
      { u: 'B', s: 'bloque', t: t0 + 2 * H, k: null, m: true },
      { u: 'C', s: 'leve', t: t0 + 2 * H, k: null, m: true },
    ],
  }

  it('only keeps schools without a counted signal, excluding lifted', () => {
    const rows = mobilisationAt(withMob, t0 + 3 * H, 5)
    expect(rows.map((r) => r.uai)).toEqual(['B'])
    expect(rows[0]?.mobilisation).toBe(true)
  })

  it('mobilisations do not count in statusesAt', () => {
    expect(statusesAt(withMob, t0 + 3 * H, 5).map((r) => r.uai)).toEqual(['A'])
  })
})
