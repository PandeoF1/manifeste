import { describe, expect, test } from 'bun:test'
import { countsAsStatus, isListed, isMobilisation, tierOf } from '../src/tiers.ts'

describe('tierOf', () => {
  const s = 'blocked'
  test('follows the judge probability and nature', () => {
    expect(tierOf({ probability: 0.8, nature: 'blockade', status: s })).toBe('confirmed')
    expect(tierOf({ probability: 0.6, nature: 'closed', status: s })).toBe('confirmed')
    expect(tierOf({ probability: 0.7, nature: 'incident', status: s })).toBe('mobilisation')
    expect(tierOf({ probability: 0.7, nature: 'other', status: 'lifted' })).toBe('confirmed')
    expect(tierOf({ probability: 0.4, nature: 'blockade', status: s })).toBe('mobilisation')
    expect(tierOf({ probability: 0.1, nature: 'gathering', status: s })).toBe('mobilisation')
    expect(tierOf({ probability: 0.1, nature: 'incident', status: s })).toBe('mobilisation')
    expect(tierOf({ probability: 0.1, nature: 'other', status: s })).toBe('not_retained')
  })

  test('unjudged, level conflicts and on-site reports', () => {
    expect(tierOf({ probability: null, nature: null, status: s })).toBe('unjudged')
    expect(tierOf({ probability: 0.9, nature: 'blockade', status: s, levelConflict: true })).toBe(
      'not_retained',
    )
    expect(tierOf({ probability: null, nature: null, status: s, onSite: true })).toBe('confirmed')
  })

  test('thresholds come from the settings', () => {
    const r = { probability: 0.25, nature: 'blockade' as const, status: s }
    expect(tierOf(r)).toBe('not_retained')
    expect(tierOf(r, { keep: 0.5, low: 0.2 })).toBe('mobilisation')
  })
})

describe('what is counted and shown', () => {
  test('tiers off: every report counts', () => {
    for (const tier of ['confirmed', 'mobilisation', 'not_retained', 'unjudged'] as const) {
      expect(countsAsStatus(tier, false)).toBe(true)
      expect(isMobilisation(tier, 'blocked', false)).toBe(false)
    }
  })

  test('tiers on: confirmed and unjudged count, mobilisation is apart, never as blocked', () => {
    expect(countsAsStatus('confirmed', true)).toBe(true)
    expect(countsAsStatus('unjudged', true)).toBe(true)
    expect(countsAsStatus('mobilisation', true)).toBe(false)
    expect(countsAsStatus('not_retained', true)).toBe(false)
    expect(isMobilisation('mobilisation', 'blocked', true)).toBe(true)
    expect(isMobilisation('mobilisation', 'lifted', true)).toBe(false)
    expect(isListed('not_retained', 'blocked', true)).toBe(false)
    expect(isListed('mobilisation', 'filtering', true)).toBe(true)
  })
})
