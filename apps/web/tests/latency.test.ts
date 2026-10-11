import { describe, expect, it } from 'bun:test'
import { LATENCY_EDGES_MS, barLabel, fmtDuration } from '../src/lib/latency'

describe('latency formats', () => {
  it('durations in ms, s and min', () => {
    expect(fmtDuration(850)).toBe('850 ms')
    expect(fmtDuration(2400)).toBe('2,4 s')
    expect(fmtDuration(180_000)).toBe('3 min')
  })
  it('one label per bar, first and last open-ended', () => {
    expect(barLabel(0)).toBe('< 10 ms')
    expect(barLabel(1)).toBe('10 ms à 30 ms')
    expect(barLabel(LATENCY_EDGES_MS.length)).toBe('> 5 min')
  })
})
