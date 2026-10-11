import { describe, expect, it } from 'bun:test'
import { computeStats } from '@/queries/stats'

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
