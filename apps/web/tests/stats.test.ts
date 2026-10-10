import { describe, expect, it } from 'bun:test'
import { computeStats } from '@/queries/stats'

const now = Date.parse('2026-10-05T10:00:00Z')
const row = (
  status: 'bloque' | 'filtrant' | 'leve',
  department: string | null,
  minutesAgo: number,
) => ({
  status,
  department,
  last_signal_at: new Date(now - minutesAgo * 60_000).toISOString(),
})

describe('computeStats', () => {
  it('compte statuts, départements et signaux de la dernière heure', () => {
    const stats = computeStats(
      [
        row('bloque', '75', 10),
        row('bloque', '75', 90),
        row('filtrant', '93', 30),
        row('leve', '69', 5),
        row('bloque', null, 200),
      ],
      now,
    )
    expect(stats).toEqual({ bloque: 3, filtrant: 1, leve: 1, departments: 2, lastHour: 2 })
  })

  it('ignore les lycées levés pour les départements et la dernière heure', () => {
    expect(computeStats([row('leve', '13', 1)], now)).toMatchObject({ departments: 0, lastHour: 0 })
  })
})
