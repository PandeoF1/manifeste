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

describe('lecture de admin_ai_usage', () => {
  it('compte la réflexion dans la sortie et ignore les tâches inconnues', () => {
    const rows = parseAiUsage(raw)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ prompt: 20000, output: 5000, thoughts: 1000 })
    expect(parseAiUsage(null)).toEqual([])
  })
})

describe('séries par modèle', () => {
  it('ordonne les modèles connus et garde leur couleur, même si un autre manque', () => {
    expect(
      seriesFor(['gemini-3.8-flash', 'gemini-3.5-flash-lite']).map((s) => [s.key, s.color]),
    ).toEqual([
      ['gemini-3.5-flash-lite', 'var(--series-1)'],
      ['gemini-3.8-flash', 'var(--series-4)'],
    ])
  })
  it('regroupe au-delà de 4 modèles dans « Autres »', () => {
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
  it('met en forme le nom', () => {
    expect(modelLabel('gemini-3.5-flash-lite')).toBe('Gemini 3.5 Flash Lite')
  })
})

describe('agrégation', () => {
  const rows = parseAiUsage(raw)
  const series = seriesFor(rows.map((r) => r.model))
  it('un compteur par jour, zéro les jours sans appel', () => {
    const b = dailyBuckets(rows, series, 'prompt', 3, '2026-10-08')
    expect(b.map((d) => d.day)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'])
    expect(b.map((d) => d.total)).toEqual([0, 20000, 39000])
    // série 0 : Flash-Lite ; série 1 : 3.8 Flash
    expect(b[2]?.values).toEqual([39000, 0])
  })
  it('totaux et classement des tâches', () => {
    expect(totals(rows)).toMatchObject({ calls: 6, prompt: 59000, output: 14000 })
    expect(byTask(rows).map((t) => t.task)).toEqual(['extraction', 'media'])
  })
  it('abrège les grands nombres', () => {
    expect(compactTokens(950)).toBe('950')
    expect(compactTokens(1500)).toBe('1,5 k')
    expect(compactTokens(42000)).toBe('42 k')
    expect(compactTokens(2_700_000)).toBe('2,7 M')
  })
})

describe('enregistrement', () => {
  const usage = {
    a: { calls: 2, promptTokens: 10, outputTokens: 3, thoughtsTokens: 1 },
    b: { calls: 0, promptTokens: 0, outputTokens: 0, thoughtsTokens: 0 },
  }
  it("n'enregistre que les modèles qui ont répondu", () => {
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
  it('ne fait jamais échouer la collecte', async () => {
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
