import { describe, expect, it } from 'bun:test'
import {
  byTask,
  compactTokens,
  dailyBuckets,
  modelLabel,
  parseAiUsage,
  seriesFor,
  totals,
} from '@/lib/aiUsage'
import { recordAiUsage, usageRows } from '@shared/ai-usage.ts'

const raw = [
  {
    day: '2026-10-07',
    task: 'extraction',
    model: 'gemini-3.8-flash',
    calls: 2,
    prompt_tokens: 20000,
    output_tokens: 4000,
    thoughts_tokens: 1000,
  },
  {
    day: '2026-10-08',
    task: 'extraction',
    model: 'gemini-3.5-flash-lite',
    calls: 3,
    prompt_tokens: 30000,
    output_tokens: 6000,
    thoughts_tokens: 0,
  },
  {
    day: '2026-10-08',
    task: 'media',
    model: 'gemini-3.5-flash-lite',
    calls: 1,
    prompt_tokens: 9000,
    output_tokens: 3000,
    thoughts_tokens: 0,
  },
  {
    day: '2026-10-08',
    task: 'inconnue',
    model: 'x',
    calls: 9,
    prompt_tokens: 1,
    output_tokens: 1,
    thoughts_tokens: 0,
  },
]

describe('reading admin_ai_usage', () => {
  it('counts thinking as output and ignores unknown tasks', () => {
    const rows = parseAiUsage(raw)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ prompt: 20000, output: 5000, thoughts: 1000 })
    expect(parseAiUsage(null)).toEqual([])
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
  const rows = parseAiUsage(raw)
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
    expect(byTask(rows).map((t) => t.task)).toEqual(['extraction', 'media'])
  })
  it('abbreviates large numbers', () => {
    expect(compactTokens(950)).toBe('950')
    expect(compactTokens(1500)).toBe('1,5 k')
    expect(compactTokens(42000)).toBe('42 k')
    expect(compactTokens(2_700_000)).toBe('2,7 M')
  })
})

describe('recording', () => {
  const usage = {
    a: { calls: 2, promptTokens: 10, outputTokens: 3, thoughtsTokens: 1 },
    b: { calls: 0, promptTokens: 0, outputTokens: 0, thoughtsTokens: 0 },
  }
  it('only records the models that answered', () => {
    expect(usageRows('media', usage)).toEqual([
      {
        task: 'media',
        model: 'a',
        calls: 2,
        prompt_tokens: 10,
        output_tokens: 3,
        thoughts_tokens: 1,
      },
    ])
  })
  it('never makes the collection fail', async () => {
    const calls: unknown[] = []
    await recordAiUsage(
      { rpc: async (fn, args) => (calls.push([fn, args]), { error: { message: 'absente' } }) },
      usageRows('media', usage),
    )
    await recordAiUsage(
      {
        rpc: () => {
          throw new Error('réseau')
        },
      },
      usageRows('media', usage),
    )
    await recordAiUsage(
      {
        rpc: async () => {
          throw new Error('jamais appelée')
        },
      },
      [],
    )
    expect(calls).toHaveLength(1)
  })
})
