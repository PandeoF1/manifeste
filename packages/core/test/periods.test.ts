import { describe, expect, test } from 'bun:test'
import { periodSince } from '../src/periods.ts'

const settings = { status_ttl_hours: 5, movement_start: '2026-09-14' }
const now = new Date('2026-10-05T12:00:00Z')

describe('periodSince', () => {
  test('live: the configured duration', () => {
    expect(periodSince('live', settings, now).toISOString()).toBe('2026-10-05T07:00:00.000Z')
  })

  test('24 h and 7 days', () => {
    expect(periodSince('24h', settings, now).toISOString()).toBe('2026-10-04T12:00:00.000Z')
    expect(periodSince('7d', settings, now).toISOString()).toBe('2026-09-28T12:00:00.000Z')
  })

  test('all: since the start of the movement, midnight Paris time', () => {
    expect(periodSince('all', settings, now).toISOString()).toBe('2026-09-13T22:00:00.000Z')
  })

  test('never before the start of the movement', () => {
    const early = new Date('2026-09-15T00:00:00Z')
    expect(periodSince('7d', settings, early).toISOString()).toBe('2026-09-13T22:00:00.000Z')
  })
})
