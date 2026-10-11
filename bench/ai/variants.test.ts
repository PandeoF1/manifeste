import { describe, expect, test } from 'bun:test'
import { createAi, DEFAULT_AI_CONFIG } from '@manifeste/ai'
import {
  credentials,
  extractConfig,
  judgeConfig,
  parseExtractSpec,
  parseJudgeSpec,
} from './variants.ts'

describe('variant specs', () => {
  test('judge specs', () => {
    expect(parseJudgeSpec('jev-recorded').kind).toBe('recorded')
    expect(parseJudgeSpec('jev')).toMatchObject({ kind: 'jev', model: 'jev-1.13.0' })
    expect(parseJudgeSpec('jev@jev-2')).toMatchObject({ kind: 'jev', model: 'jev-2' })
    expect(parseJudgeSpec('llm:gemini:gemini-3.5-flash', 0)).toMatchObject({
      kind: 'llm',
      model: { provider: 'gemini', model: 'gemini-3.5-flash', thinkingBudget: 0 },
    })
    expect(() => parseJudgeSpec('gpt')).toThrow(/unknown judge variant/)
    expect(() => parseJudgeSpec('llm:nobody:x')).toThrow(/bad model/)
  })

  test('extract specs', () => {
    expect(parseExtractSpec('v1-strict@anthropic:claude-haiku-5-5')).toMatchObject({
      prompt: 'v1-strict',
      model: { provider: 'anthropic', model: 'claude-haiku-5-5' },
    })
    expect(() => parseExtractSpec('v9@gemini:x')).toThrow(/unknown extract variant/)
    expect(() => parseExtractSpec('v1')).toThrow(/unknown extract variant/)
  })

  test('every spec builds a valid offline configuration with one model and no fallback', () => {
    const creds = credentials(false, {})
    const judge = createAi(judgeConfig(parseJudgeSpec('llm:anthropic:claude-haiku-5-5'), creds))
    expect(judge.judge()?.provider).toBe('anthropic')
    const extract = createAi(extractConfig(parseExtractSpec('v1@gemini:gemini-3.5-flash'), creds))
    expect(extract.config.tasks.extract.models).toHaveLength(1)
    expect(extract.config.tasks.extract.prompt).toBe('v1')
    expect(DEFAULT_AI_CONFIG.tasks.extract.models.length).toBeGreaterThan(1) // untouched
  })

  test('live credentials come from the environment, offline ones are placeholders', () => {
    expect(credentials(true, { GEMINI_API_KEY: 'g' }).gemini?.apiKey).toBe('g')
    expect(credentials(false, { GEMINI_API_KEY: 'g' }).gemini?.apiKey).toBe('offline')
    expect(
      credentials(true, { OPENAI_BASE_URL: 'https://x/v1', OPENAI_API_KEY: 'k' }).openaiCompatible,
    ).toEqual({ default: { baseUrl: 'https://x/v1', apiKey: 'k' } })
  })
})
