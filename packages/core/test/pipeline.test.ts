import { describe, expect, test } from 'bun:test'
import {
  afterAttempt,
  beforeAttempt,
  BREAKER,
  isLane,
  mayAttempt,
  mergeSameArticle,
  type SourceState,
} from '../src/index.ts'

const NOW = new Date('2026-10-10T10:00:00Z')
const closed: SourceState = { health: 'closed', consecutiveFailures: 0, nextAttemptAt: null }

describe('source circuit breaker', () => {
  test('stays closed below the threshold, opens at it', () => {
    let s = closed
    for (let i = 1; i < BREAKER.threshold; i++) {
      s = afterAttempt(s, false, NOW)
      expect(s).toEqual({ health: 'closed', consecutiveFailures: i, nextAttemptAt: null })
    }
    s = afterAttempt(s, false, NOW)
    expect(s.health).toBe('open')
    expect(s.nextAttemptAt?.getTime()).toBe(NOW.getTime() + BREAKER.basePauseMs)
  })

  test('an open breaker blocks until its pause is over, then lets one attempt through', () => {
    const open = afterAttempt({ ...closed, consecutiveFailures: BREAKER.threshold - 1 }, false, NOW)
    expect(mayAttempt(open, new Date(NOW.getTime() + 60_000))).toBe(false)
    const later = new Date(NOW.getTime() + BREAKER.basePauseMs)
    expect(mayAttempt(open, later)).toBe(true)
    expect(beforeAttempt(open, later).health).toBe('half_open')
    expect(beforeAttempt(open, NOW).health).toBe('open')
  })

  test('a failed trial reopens with a longer pause; a success closes and forgets', () => {
    const trial: SourceState = { health: 'half_open', consecutiveFailures: 3, nextAttemptAt: null }
    const reopened = afterAttempt(trial, false, NOW)
    expect(reopened.health).toBe('open')
    expect(reopened.nextAttemptAt?.getTime()).toBe(NOW.getTime() + 2 * BREAKER.basePauseMs)
    expect(afterAttempt(reopened, true, NOW)).toEqual(closed)
  })

  test('the pause is capped', () => {
    const s = afterAttempt(
      { health: 'half_open', consecutiveFailures: 40, nextAttemptAt: null },
      false,
      NOW,
    )
    expect(s.nextAttemptAt?.getTime()).toBe(NOW.getTime() + BREAKER.maxPauseMs)
  })

  test('a failed trial opens even below the threshold count', () => {
    const s = afterAttempt(
      { health: 'half_open', consecutiveFailures: 0, nextAttemptAt: null },
      false,
      NOW,
    )
    expect(s.health).toBe('open')
  })
})

describe('merging the same article', () => {
  const item = (url: string, text: string, extra: object = {}) => ({ url, text, ...extra })

  test('same canonical URL: one item with the union of the lines', () => {
    const a = item('https://press.fr/a?utm_source=x', 'Titre\nLycée Pasteur bloqué')
    const b = item('https://press.fr/a/', 'titre\nBarrage filtrant à Lille')
    const c = item('https://press.fr/other', 'Autre')
    const { kept, absorbed } = mergeSameArticle([a, b, c])
    expect(kept).toHaveLength(2)
    expect(kept[0]?.text).toBe('Titre\nLycée Pasteur bloqué\nBarrage filtrant à Lille')
    expect(absorbed).toHaveLength(1)
    expect(absorbed[0]?.item).toBe(b)
    expect(absorbed[0]?.into).toBe(kept[0])
  })

  test('map points and always-relevant items are never merged', () => {
    const point = item('https://maps.example/x', 'Carte', { geo: { lat: 1, lng: 2 } })
    const { kept, absorbed } = mergeSameArticle([
      point,
      { ...point },
      item('https://a.fr/1', 'x', { alwaysRelevant: true }),
      item('https://a.fr/1', 'x', { alwaysRelevant: true }),
    ])
    expect(kept).toHaveLength(4)
    expect(absorbed).toHaveLength(0)
  })
})

describe('lanes', () => {
  test('only the states that need attention are lanes', () => {
    expect(['unreadable', 'deferred', 'failed'].every(isLane)).toBe(true)
    expect(['done', 'irrelevant', 'discovered'].some(isLane)).toBe(false)
  })
})
