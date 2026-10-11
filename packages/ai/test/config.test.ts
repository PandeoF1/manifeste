import { describe, expect, test } from 'bun:test'
import {
  aiConfigFromEnv,
  AiConfigError,
  createAi,
  createMeter,
  DEFAULT_AI_CONFIG,
  replayModel,
  validateAiConfig,
  type AiConfig,
} from '../src/index.ts'
import { at, fakeFetch, json, noSleep } from './helpers.ts'

const withKeys: AiConfig = {
  ...DEFAULT_AI_CONFIG,
  credentials: { gemini: { apiKey: 'g' }, jev: { apiKey: 'j' }, openaiCompatible: {} },
}

describe('AI configuration', () => {
  test('defaults reproduce production: Flash-Lite first, three Flash fallbacks, Jev judge', () => {
    const config = validateAiConfig(withKeys)
    expect(config.tasks.extract.models.map((m) => m.model)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ])
    expect(config.tasks.judge).toEqual({ kind: 'jev', model: 'jev-1.13.0' })
    expect(config.tasks.extract.prompt).toBe('v1')
  })

  test('a model without credentials fails at validation, not at the first call', () => {
    expect(() => validateAiConfig(DEFAULT_AI_CONFIG)).toThrow(/without credentials: gemini/)
    expect(() => validateAiConfig({ ...DEFAULT_AI_CONFIG, enabled: false })).not.toThrow()
  })

  test('a typo is reported with its path', () => {
    const bad = structuredClone(withKeys) as unknown as { tasks: { extract: { prompt: string } } }
    bad.tasks.extract.prompt = 'v9'
    expect(() => validateAiConfig(bad)).toThrow(AiConfigError)
    expect(() => validateAiConfig(bad)).toThrow(/extract\/prompt/)
  })

  test('from the environment', () => {
    const config = aiConfigFromEnv({
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'gemini-x',
      GEMINI_FALLBACK_MODELS: 'gemini-y, gemini-x',
      GEMINI_THINKING_BUDGET: '0',
      GEMINI_TEXT_CHARS: '3000',
      GEMINI_PROMPT: 'v1-strict',
      JEV_API_KEY: 'j',
      AI_DAILY_BUDGET_USD: '2.5',
    })
    expect(config.tasks.extract.models).toEqual([
      { provider: 'gemini', model: 'gemini-x', thinkingBudget: 0 },
      { provider: 'gemini', model: 'gemini-y', thinkingBudget: 0 },
    ])
    expect(config.tasks.extract).toMatchObject({ prompt: 'v1-strict', textChars: 3000 })
    expect(config.budget.dailyUsd).toBe(2.5)
    expect(() => validateAiConfig(config)).not.toThrow()
    // Without a Jev key the judge is simply off.
    expect(aiConfigFromEnv({ GEMINI_API_KEY: 'k' }).tasks.judge.kind).toBe('off')
    expect(aiConfigFromEnv({ AI_ENABLED: 'false' }).enabled).toBe(false)
  })
})

describe('createAi', () => {
  test('the kill switch refuses calls without touching the network', async () => {
    const { fetch, seen } = fakeFetch()
    const ai = createAi({ ...withKeys, enabled: false }, { fetch, sleep: noSleep })
    const error = await ai
      .extractChain()
      .generate({ system: 's', user: 'u', schema: {} as never })
      .catch((e) => e)
    expect(error.kind).toBe('disabled')
    expect(seen).toHaveLength(0)
  })

  test('the daily budget refuses calls once reached', async () => {
    const { fetch } = fakeFetch()
    const ai = createAi(
      { ...withKeys, budget: { dailyUsd: 1 } },
      { fetch, spentToday: () => 1.2, sleep: noSleep },
    )
    const error = await ai
      .mediaChain()
      .generate({ system: 's', user: 'u', schema: {} as never })
      .catch((e) => e)
    expect(error.kind).toBe('budget')
  })

  test('falls back along the configured models and accounts for each call', async () => {
    const answer = json({
      candidates: [{ content: { parts: [{ text: '{"events":[]}' }] } }],
      usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
    })
    const { fetch, seen } = fakeFetch(json({ error: { message: 'quota' } }, 429), answer)
    const meter = createMeter()
    const ai = createAi(withKeys, { fetch, sink: meter, sleep: noSleep })
    const result = await ai.extractChain().generate({ system: 's', user: 'u', schema: {} as never })
    expect(result.model).toBe('gemini-3.5-flash')
    expect(seen.map((s) => s.url.match(/models\/([^:]+):/)?.[1])).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
    ])
    const rows = meter.drain()
    expect(rows.map((r) => [r.model, r.failures])).toEqual([
      ['gemini-3.5-flash-lite', 1],
      ['gemini-3.5-flash', 0],
    ])
    expect(at(rows, 1).costUsd).toBeCloseTo(0.3) // one million prompt tokens at 0.30 USD
  })

  test('judge is null when off, and replay models serve recordings', async () => {
    expect(
      createAi({ ...withKeys, tasks: { ...withKeys.tasks, judge: { kind: 'off' } } }).judge(),
    ).toBeNull()
    expect(createAi(withKeys).judge()?.provider).toBe('jev')
    expect(replayModel('replay', 'm', new Map()).provider).toBe('replay')
  })
})

describe('OpenAI-compatible servers', () => {
  test('a configured server validates; a model pointing at a missing one fails', () => {
    const base: AiConfig = {
      ...withKeys,
      credentials: {
        ...withKeys.credentials,
        openaiCompatible: { local: { baseUrl: 'http://localhost:11434/v1', apiKey: 'x' } },
      },
    }
    const use = (server: string): AiConfig => ({
      ...base,
      tasks: {
        ...base.tasks,
        media: { models: [{ provider: 'openai-compatible', model: 'llama', server }] },
      },
    })
    expect(() => validateAiConfig(use('local'))).not.toThrow()
    expect(() => validateAiConfig(use('elsewhere'))).toThrow(/openai-compatible\/elsewhere/)
    const bad = structuredClone(base)
    bad.credentials.openaiCompatible.local = { baseUrl: 'not a url', apiKey: 'x' }
    expect(() => validateAiConfig(bad)).toThrow(AiConfigError)
  })
})
