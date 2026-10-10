import { describe, expect, it } from 'bun:test'
import { DEFAULT_SETTINGS, parseSettings, periodDescription, periodSince } from '../src/lib/periods'

const settings = { statusTtlHours: 5, movementStart: '2026-09-14', judgeTiers: false }
const now = Date.parse('2026-10-05T12:00:00Z')

describe('periodSince', () => {
  it('live: configured duration', () => {
    expect(periodSince('direct', settings, now).toISOString()).toBe('2026-10-05T07:00:00.000Z')
  })
  it('24 h and 7 days', () => {
    expect(periodSince('24h', settings, now).toISOString()).toBe('2026-10-04T12:00:00.000Z')
    expect(periodSince('7j', settings, now).toISOString()).toBe('2026-09-28T12:00:00.000Z')
  })
  it('all: since the start of the movement, midnight Paris time', () => {
    expect(periodSince('tout', settings, now).toISOString()).toBe('2026-09-13T22:00:00.000Z')
  })
  it('never before the start of the movement', () => {
    const early = Date.parse('2026-09-16T12:00:00Z')
    expect(periodSince('7j', settings, early).toISOString()).toBe('2026-09-13T22:00:00.000Z')
  })
})

describe('periodDescription', () => {
  it('words each period', () => {
    expect(periodDescription('direct', settings)).toBe('ces 5 dernières heures')
    expect(periodDescription('direct', { ...settings, statusTtlHours: 1 })).toBe(
      'cette dernière heure',
    )
    expect(periodDescription('7j', settings)).toBe('ces 7 derniers jours')
    expect(periodDescription('tout', settings)).toBe('depuis le 14 septembre')
  })
})

describe('parseSettings', () => {
  it('reads the settings and ignores invalid values', () => {
    expect(
      parseSettings([
        { key: 'status_ttl_hours', value: '12' },
        { key: 'movement_start', value: '2026-09-10' },
      ]),
    ).toEqual({ statusTtlHours: 12, movementStart: '2026-09-10', judgeTiers: false })
    expect(parseSettings([{ key: 'judge_tiers', value: 'on' }]).judgeTiers).toBe(true)
    expect(parseSettings([{ key: 'judge_tiers', value: 'oui' }]).judgeTiers).toBe(false)
    expect(
      parseSettings([
        { key: 'status_ttl_hours', value: 'abc' },
        { key: 'movement_start', value: 'hier' },
      ]),
    ).toEqual(DEFAULT_SETTINGS)
  })
})
