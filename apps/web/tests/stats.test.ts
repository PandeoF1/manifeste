import { describe, expect, it } from 'bun:test'
import { computeStats } from '@/queries/stats'
import { isMajorTick, isPartialSlot } from '@/lib/siteStats'

const now = Date.parse('2026-10-05T10:00:00Z')
const row = (
  status: 'blocked' | 'filtering' | 'lifted',
  department: string | null,
  minutesAgo: number,
) => ({
  status,
  department,
  lastSignalAt: new Date(now - minutesAgo * 60_000),
})

describe('computeStats', () => {
  it('counts statuses, departments and signals of the last hour', () => {
    const stats = computeStats(
      [
        row('blocked', '75', 10),
        row('blocked', '75', 90),
        row('filtering', '93', 30),
        row('lifted', '69', 5),
        row('blocked', null, 200),
      ],
      now,
    )
    expect(stats).toEqual({ blocked: 3, filtering: 1, lifted: 1, departments: 2, lastHour: 2 })
  })

  it('ignores lifted schools for departments and the last hour', () => {
    expect(computeStats([row('lifted', '13', 1)], now)).toMatchObject({
      departments: 0,
      lastHour: 0,
    })
  })
})

describe('time axis', () => {
  // 2026-10-14 is summer time in Paris (UTC+2).
  it('24 h: a label every 4 hours, Paris time', () => {
    expect(isMajorTick('2026-10-14T22:00:00Z', '24h')).toBe(true) // 00:00
    expect(isMajorTick('2026-10-15T02:00:00Z', '24h')).toBe(true) // 04:00
    expect(isMajorTick('2026-10-14T23:45:00Z', '24h')).toBe(false) // 01:45
    expect(isMajorTick('2026-10-14T23:00:00Z', '24h')).toBe(false) // 01:00
  })
  it('2 h: every half hour', () => {
    expect(isMajorTick('2026-10-14T22:30:00Z', '2h')).toBe(true)
    expect(isMajorTick('2026-10-14T22:35:00Z', '2h')).toBe(false)
  })
  it('7 days: Paris midnights', () => {
    expect(isMajorTick('2026-10-14T22:00:00Z', '7d')).toBe(true)
    expect(isMajorTick('2026-10-14T23:00:00Z', '7d')).toBe(false)
  })
  it('30 and 90 days: spaced days', () => {
    expect(isMajorTick('2026-10-05T22:00:00Z', '30d')).toBe(true) // the 6th
    expect(isMajorTick('2026-10-06T22:00:00Z', '30d')).toBe(false) // the 7th
    expect(isMajorTick('2026-09-30T22:00:00Z', '30d')).toBe(true) // the 1st (Paris)
    expect(isMajorTick('2026-10-30T23:00:00Z', '30d')).toBe(false) // the 31st is not shown
    expect(isMajorTick('2026-10-14T22:00:00Z', '90d')).toBe(true) // the 15th
  })
  it('the running slot is the one that has not ended yet', () => {
    const now = Date.parse('2026-10-14T23:50:00Z')
    expect(isPartialSlot('2026-10-14T23:45:00Z', 900, now)).toBe(true)
    expect(isPartialSlot('2026-10-14T23:30:00Z', 900, now)).toBe(false)
  })
})
