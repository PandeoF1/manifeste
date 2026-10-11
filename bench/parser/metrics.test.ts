import { describe, expect, test } from 'bun:test'
import {
  boilerplateShare,
  buildBoilerplateIndex,
  mean,
  percentile,
  scoreDate,
  summarize,
  type PageRecord,
} from './metrics.ts'

describe('percentile and mean', () => {
  test('nearest rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([], 50)).toBe(0)
    expect(mean([2, 4])).toBe(3)
  })
})

describe('boilerplate reference', () => {
  const menu = 'Abonnez-vous à la newsletter du journal'
  const pages = Array.from({ length: 10 }, (_, i) => ({
    domain: 'journal.example',
    lines: [menu, `Article numéro ${i} : le lycée est bloqué depuis ce matin`],
  }))

  test('lines repeated across a site are boilerplate, unique ones are not', () => {
    const index = buildBoilerplateIndex(pages)
    expect(boilerplateShare(index, 'journal.example', [menu])).toBe(1)
    expect(
      boilerplateShare(index, 'journal.example', ['Un tout autre article sur le blocus du lycée']),
    ).toBe(0)
    const mixed = boilerplateShare(index, 'journal.example', [
      menu,
      'Un tout autre article sur le blocus du lycée',
    ])
    expect(mixed).toBeGreaterThan(0)
    expect(mixed).toBeLessThan(1)
  })

  test('digits do not hide a repeated line', () => {
    const index = buildBoilerplateIndex(
      Array.from({ length: 10 }, (_, i) => ({
        domain: 'a.example',
        lines: [`Publié le ${i}/10/2026 à 10h${i}0`],
      })),
    )
    expect(boilerplateShare(index, 'a.example', ['Publié le 7/10/2026 à 10h00'])).toBe(1)
  })

  test('a site with too few pages has no reference', () => {
    const index = buildBoilerplateIndex(pages.slice(0, 3))
    expect(boilerplateShare(index, 'journal.example', [menu])).toBeNull()
    expect(boilerplateShare(index, 'other.example', [menu])).toBeNull()
  })

  test('empty output has no share', () => {
    expect(boilerplateShare(buildBoilerplateIndex(pages), 'journal.example', ['', '  '])).toBeNull()
  })
})

describe('scoreDate', () => {
  const expected = Date.parse('2026-10-05T10:00:00Z') / 1000
  test('exact, same day, other day, missing', () => {
    expect(scoreDate(new Date('2026-10-05T10:30:00Z'), expected)).toEqual({
      found: true,
      within1h: true,
      sameDay: true,
    })
    expect(scoreDate(new Date('2026-10-05T15:00:00Z'), expected)).toEqual({
      found: true,
      within1h: false,
      sameDay: true,
    })
    expect(scoreDate(new Date('2026-10-04T10:00:00Z'), expected)).toEqual({
      found: true,
      within1h: false,
      sameDay: false,
    })
    expect(scoreDate(null, expected)).toEqual({ found: false, within1h: false, sameDay: false })
    expect(scoreDate(new Date('nope'), expected).found).toBe(false)
  })

  test('the day is the Paris day', () => {
    // 22:30 UTC is already the next day in Paris in October.
    expect(
      scoreDate(new Date('2026-10-05T22:30:00Z'), Date.parse('2026-10-06T08:00:00Z') / 1000)
        .sameDay,
    ).toBe(true)
  })
})

describe('summarize', () => {
  const record = (over: Partial<PageRecord>): PageRecord => ({
    hash: 'x',
    domain: 'a.example',
    ms: 10,
    chars: 1000,
    boilerplate: null,
    mentions: [],
    date: null,
    blocked: null,
    ...over,
  })

  test('recall counts only reachable pairs, capped and whole', () => {
    const s = summarize([
      record({
        mentions: [
          { reachable: true, found: true, foundFull: true },
          { reachable: true, found: false, foundFull: true },
          { reachable: false, found: false, foundFull: false },
        ],
      }),
    ])
    expect(s.mention).toEqual({
      pairs: 3,
      reachable: 2,
      found: 1,
      recallPct: 50,
      recallFullPct: 100,
    })
  })

  test('empty pages, dates, boilerplate, latency and blocked pages', () => {
    const s = summarize([
      record({ chars: 50, ms: 5, blocked: 'bot-wall' }),
      record({
        chars: 3000,
        ms: 15,
        date: { found: true, within1h: true, sameDay: true },
        boilerplate: 0.1,
      }),
      record({
        chars: 2000,
        ms: 100,
        date: { found: false, within1h: false, sameDay: false },
        boilerplate: 0.3,
      }),
    ])
    expect(s.text.emptyPct).toBeCloseTo(33.3, 1)
    expect(s.date).toEqual({ labelled: 2, foundPct: 50, sameDayPct: 50, within1hPct: 50 })
    expect(s.boilerplate).toEqual({ pagesScored: 2, meanPct: 20 })
    expect(s.latency.p50Ms).toBe(15)
    expect(s.blocked.flagged).toBe(1)
  })

  test('nothing to score gives null, not zero', () => {
    const s = summarize([record({})])
    expect(s.mention.recallPct).toBeNull()
    expect(s.date.foundPct).toBeNull()
    expect(s.boilerplate.meanPct).toBeNull()
  })
})
