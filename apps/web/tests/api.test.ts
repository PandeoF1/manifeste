import { describe, expect, it } from 'bun:test'
import { reviveDates } from '@/lib/api'

describe('reviveDates', () => {
  it('turns the timestamps of the API into Dates, nowhere else', () => {
    const out = reviveDates({
      at: '2026-10-11T15:00:00.000Z',
      zoned: '2026-10-11T17:00:00+02:00',
      day: '2026-10-11',
      movement_start: '2026-09-14',
      name: 'Lycée Pasteur',
      list: [{ lastSignalAt: '2026-10-11T15:00:00Z' }, 'not a date'],
    }) as unknown as {
      at: Date
      zoned: Date
      day: string
      movement_start: string
      name: string
      list: [{ lastSignalAt: Date }, string]
    }
    expect(out.at).toEqual(new Date('2026-10-11T15:00:00.000Z'))
    expect(out.zoned).toEqual(new Date('2026-10-11T15:00:00Z'))
    expect(out.day).toBe('2026-10-11')
    expect(out.movement_start).toBe('2026-09-14')
    expect(out.name).toBe('Lycée Pasteur')
    expect(out.list[0]?.lastSignalAt).toBeInstanceOf(Date)
    expect(out.list[1]).toBe('not a date')
  })

  it('leaves what is not plain data alone', () => {
    const d = new Date()
    expect(reviveDates(d)).toBe(d)
    expect(reviveDates(null)).toBeNull()
    expect(reviveDates(3)).toBe(3)
  })
})
