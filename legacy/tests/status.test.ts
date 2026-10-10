import { describe, expect, it } from 'vitest'
import { formatRelative, isStatusExpired } from '@shared/status.ts'

const now = new Date('2026-10-04T12:00:00Z')

describe('expiration des statuts', () => {
  it('actif avant le TTL de 5 h', () => {
    expect(isStatusExpired(new Date('2026-10-04T07:01:00Z'), now)).toBe(false)
  })
  it('expiré à 5 h pile et au-delà', () => {
    expect(isStatusExpired(new Date('2026-10-04T07:00:00Z'), now)).toBe(true)
    expect(isStatusExpired(new Date('2026-10-03T12:00:00Z'), now)).toBe(true)
  })
  it('TTL configurable', () => {
    expect(isStatusExpired(new Date('2026-10-04T10:30:00Z'), now, 1)).toBe(true)
  })
})

describe('formatRelative', () => {
  it.each([
    ['2026-10-04T11:59:50Z', "à l'instant"],
    ['2026-10-04T11:48:00Z', 'il y a 12 min'],
    ['2026-10-04T09:00:00Z', 'il y a 3 h'],
    ['2026-10-02T09:00:00Z', 'il y a 2 j'],
  ])('%s -> %s', (date, expected) => {
    expect(formatRelative(new Date(date), now)).toBe(expected)
  })
})
