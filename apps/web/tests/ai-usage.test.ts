import { describe, expect, it } from 'bun:test'
import {
  byTask,
  compactTokens,
  dailyBuckets,
  modelLabel,
  fromApiUsage,
  seriesFor,
  totals,
} from '@/lib/aiUsage'

const raw = [
  {
    day: '2026-10-07',
    task: 'extract',
    model: 'gemini-3.8-flash',
    calls: 2,
    promptTokens: 20000,
    outputTokens: 4000,
    thoughtsTokens: 1000,
  },
  {
    day: '2026-10-08',
    task: 'extract',
    model: 'gemini-3.5-flash-lite',
    calls: 3,
    promptTokens: 30000,
    outputTokens: 6000,
    thoughtsTokens: 0,
  },
  {
    day: '2026-10-08',
    task: 'media',
    model: 'gemini-3.5-flash-lite',
    calls: 1,
    promptTokens: 9000,
    outputTokens: 3000,
    thoughtsTokens: 0,
  },
  {
    day: '2026-10-08',
    task: 'inconnue',
    model: 'x',
    calls: 9,
    promptTokens: 1,
    outputTokens: 1,
    thoughtsTokens: 0,
  },
]

describe('reading the API usage rows', () => {
  it('counts thinking as output and ignores unknown tasks', () => {
    const rows = fromApiUsage(raw)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ prompt: 20000, output: 5000, thoughts: 1000 })
    expect(fromApiUsage([])).toEqual([])
  })
})

describe('series per model', () => {
  it('orders known models and keeps their colour, even if another is missing', () => {
    expect(
      seriesFor(['gemini-3.8-flash', 'gemini-3.5-flash-lite']).map((s) => [s.key, s.color]),
    ).toEqual([
      ['gemini-3.5-flash-lite', 'var(--series-1)'],
      ['gemini-3.8-flash', 'var(--series-4)'],
    ])
  })
  it('groups models beyond 4 under "Autres"', () => {
    const s = seriesFor([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'nouveau',
    ])
    expect(s.map((x) => x.key)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'autres',
    ])
  })
  it('formats the name', () => {
    expect(modelLabel('gemini-3.5-flash-lite')).toBe('Gemini 3.5 Flash Lite')
  })
})

describe('aggregation', () => {
  const rows = fromApiUsage(raw)
  const series = seriesFor(rows.map((r) => r.model))
  it('one counter per day, zero on days without calls', () => {
    const b = dailyBuckets(rows, series, 'prompt', 3, '2026-10-08')
    expect(b.map((d) => d.day)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'])
    expect(b.map((d) => d.total)).toEqual([0, 20000, 39000])
    // series 0: Flash-Lite; series 1: 3.8 Flash
    expect(b[2]?.values).toEqual([39000, 0])
  })
  it('totals and ranking of tasks', () => {
    expect(totals(rows)).toMatchObject({ calls: 6, prompt: 59000, output: 14000 })
    expect(byTask(rows).map((t) => t.task)).toEqual(['extract', 'media'])
  })
  it('abbreviates large numbers', () => {
    expect(compactTokens(950)).toBe('950')
    expect(compactTokens(1500)).toBe('1,5 k')
    expect(compactTokens(42000)).toBe('42 k')
    expect(compactTokens(2_700_000)).toBe('2,7 M')
  })
})
