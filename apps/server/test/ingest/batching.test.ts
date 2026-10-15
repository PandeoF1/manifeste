import { describe, expect, test } from 'bun:test'
import { takeBatches } from '../../src/ingest/batching.ts'

const NOW = new Date('2026-10-15T12:00:00Z')
const item = (minutesAgo: number) => ({
  waitingSince: new Date(NOW.getTime() - minutesAgo * 60_000),
})
const MIN = 60_000

describe('takeBatches', () => {
  test('a partial batch waits while its oldest item is recent', () => {
    expect(takeBatches([item(1), item(2), item(3)], 15, 15 * MIN, NOW)).toEqual([])
  })

  test('full batches go, the remainder waits', () => {
    const items = Array.from({ length: 17 }, () => item(2))
    expect(takeBatches(items, 15, 15 * MIN, NOW)).toHaveLength(15)
  })

  test('once the oldest has waited long enough, everything goes', () => {
    const items = [item(20), item(1), item(1)]
    expect(takeBatches(items, 15, 15 * MIN, NOW)).toHaveLength(3)
  })

  test('no wait configured: whatever is ready goes', () => {
    expect(takeBatches([item(0)], 15, 0, NOW)).toHaveLength(1)
    expect(takeBatches([], 15, 15 * MIN, NOW)).toEqual([])
  })
})
