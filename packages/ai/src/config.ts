/**
 * The one validated AI configuration. Which provider and model serve each task, thinking
 * budgets, prompt versions, spending cap and prices all live here, and it is checked once at
 * boot: a typo in a model reference fails the start, not the third call of a night run.
 *
 * Secrets come from the environment (`aiConfigFromEnv`); everything else has a default that is
 * today's production behaviour: Gemini Flash-Lite with Flash fallbacks, and Jev as the judge.
 */
import { type Static, Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { DEFAULT_PRICES } from './pricing.ts'
import { EXTRACT_PROMPT_VERSIONS } from './prompts/extract.ts'
import { Enum } from './schema.ts'

export const PROVIDERS = ['gemini', 'anthropic', 'openai-compatible', 'replay'] as const

const ModelRef = t.Object(
  {
    provider: Enum(PROVIDERS),
    model: t.String({ minLength: 1 }),
    /** Gemini: thinking budget in tokens (0 = off). Unset: the model's default. */
    thinkingBudget: t.Optional(t.Integer({ minimum: 0 })),
    /** OpenAI-compatible: which server (key of `providers.openaiCompatible`). */
    server: t.Optional(t.String()),
  },
  { additionalProperties: false },
)
export type ModelRef = Static<typeof ModelRef>

const ModelList = t.Array(ModelRef, { minItems: 1 })

export const AiConfigSchema = t.Object(
  {
    /** Master switch. Off, every AI call fails fast with kind `disabled` (the kill switch). */
    enabled: t.Boolean(),
    credentials: t.Object(
      {
        gemini: t.Optional(t.Object({ apiKey: t.String({ minLength: 1 }) })),
        anthropic: t.Optional(t.Object({ apiKey: t.String({ minLength: 1 }) })),
        jev: t.Optional(t.Object({ apiKey: t.String({ minLength: 1 }) })),
        openaiCompatible: t.Record(
          t.String(),
          t.Object({ baseUrl: t.String({ pattern: '^https?://' }), apiKey: t.String({ minLength: 1 }) }),
        ),
      },
      { additionalProperties: false },
    ),
    tasks: t.Object(
      {
        extract: t.Object({
          /** Primary model first, then fallbacks. */
          models: ModelList,
          prompt: Enum(EXTRACT_PROMPT_VERSIONS),
          /** Characters of each item sent to the model. */
          textChars: t.Integer({ minimum: 200, maximum: 100_000 }),
          retriesPerModel: t.Integer({ minimum: 0, maximum: 5 }),
        }),
        reanalyse: t.Object({ models: ModelList }),
        media: t.Object({ models: ModelList }),
        judge: t.Union([
          t.Object({ kind: t.Literal('jev'), model: t.String({ minLength: 1 }) }),
          t.Object({ kind: t.Literal('llm'), models: ModelList }),
          t.Object({ kind: t.Literal('off') }),
        ]),
      },
      { additionalProperties: false },
    ),
    budget: t.Object({
      /** Estimated spend per UTC day above which calls are refused. 0 = no cap. */
      dailyUsd: t.Number({ minimum: 0 }),
    }),
    /** USD per million tokens, by model; completes and overrides DEFAULT_PRICES. */
    prices: t.Record(
      t.String(),
      t.Object({ inputPerMTok: t.Number({ minimum: 0 }), outputPerMTok: t.Number({ minimum: 0 }) }),
    ),
  },
  { additionalProperties: false },
)
export type AiConfig = Static<typeof AiConfigSchema>

const gemini = (model: string, thinkingBudget?: number): ModelRef => ({
  provider: 'gemini',
  model,
  ...(thinkingBudget !== undefined && { thinkingBudget }),
})

/**
 * Flash-Lite: extraction is a simple task and it is the only model whose free quota holds a
 * collection every 10 minutes (15 requests a minute, 500 a day, against 5 and 20 for Flash).
 * Fallbacks cover saturation (503), quota (429) and a model closed for the account (404).
 */
const PRIMARY_GEMINI_MODEL = 'gemini-3.5-flash-lite'
export const DEFAULT_GEMINI_MODELS = [
  PRIMARY_GEMINI_MODEL,
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
]

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: true,
  credentials: { openaiCompatible: {} },
  tasks: {
    extract: {
      models: DEFAULT_GEMINI_MODELS.map((m) => gemini(m)),
      prompt: 'v1',
      textChars: 6000,
      retriesPerModel: 1,
    },
    reanalyse: { models: DEFAULT_GEMINI_MODELS.map((m) => gemini(m)) },
    media: { models: DEFAULT_GEMINI_MODELS.map((m) => gemini(m)) },
    judge: { kind: 'jev', model: 'jev-1.13.0' },
  },
  budget: { dailyUsd: 0 },
  prices: {},
}

export class AiConfigError extends Error {}

/** Throws with every problem listed, and with a check that every model has its credentials. */
export function validateAiConfig(config: unknown): AiConfig {
  if (!Value.Check(AiConfigSchema, config)) {
    const problems = [...Value.Errors(AiConfigSchema, config)]
      .slice(0, 8)
      .map((e) => `${e.path || '/'}: ${e.message}`)
    throw new AiConfigError(`Invalid AI configuration:\n${problems.join('\n')}`)
  }
  const missing: string[] = []
  const needs = (ref: ModelRef) => {
    if (ref.provider === 'gemini' && !config.credentials.gemini)
      missing.push(`gemini (${ref.model})`)
    if (ref.provider === 'anthropic' && !config.credentials.anthropic)
      missing.push(`anthropic (${ref.model})`)
    if (ref.provider === 'openai-compatible') {
      const server = ref.server ?? 'default'
      if (!config.credentials.openaiCompatible[server])
        missing.push(`openai-compatible/${server} (${ref.model})`)
    }
  }
  if (config.enabled) {
    for (const task of [config.tasks.extract, config.tasks.reanalyse, config.tasks.media])
      task.models.forEach(needs)
    if (config.tasks.judge.kind === 'llm') config.tasks.judge.models.forEach(needs)
    if (config.tasks.judge.kind === 'jev' && !config.credentials.jev) missing.push('jev')
  }
  if (missing.length > 0)
    throw new AiConfigError(
      `AI configuration has models without credentials: ${missing.join(', ')}`,
    )
  return config
}

export const allPrices = (config: AiConfig) => ({ ...DEFAULT_PRICES, ...config.prices })

/**
 * Builds the configuration from the environment. Missing keys do not fail here: a task whose
 * provider has no key is reported by `validateAiConfig` only when AI is enabled, so a dev
 * machine without keys still boots with `AI_ENABLED=false`.
 *
 *   AI_ENABLED, AI_DAILY_BUDGET_USD, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODELS,
 *   GEMINI_THINKING_BUDGET, GEMINI_TEXT_CHARS, GEMINI_PROMPT, ANTHROPIC_API_KEY, JEV_API_KEY,
 *   JEV_MODEL, AI_JUDGE (jev | off)
 */
export function aiConfigFromEnv(env: Record<string, string | undefined>): AiConfig {
  const has = (name: string) => (env[name] ?? '').trim() !== ''
  const int = (name: string): number | undefined => {
    const n = Number(env[name])
    return has(name) && Number.isInteger(n) && n >= 0 ? n : undefined
  }
  const list = [
    ...new Set([
      has('GEMINI_MODEL') ? (env.GEMINI_MODEL as string).trim() : PRIMARY_GEMINI_MODEL,
      ...(has('GEMINI_FALLBACK_MODELS')
        ? (env.GEMINI_FALLBACK_MODELS as string).split(',').map((m) => m.trim())
        : DEFAULT_GEMINI_MODELS.slice(1)),
    ]),
  ].filter(Boolean)
  const thinking = int('GEMINI_THINKING_BUDGET')
  const refs = list.map((m) => gemini(m, thinking))
  const judgeOff = env.AI_JUDGE === 'off' || !has('JEV_API_KEY')

  return {
    enabled: env.AI_ENABLED !== 'false' && env.AI_ENABLED !== '0',
    credentials: {
      ...(has('GEMINI_API_KEY') && { gemini: { apiKey: env.GEMINI_API_KEY as string } }),
      ...(has('ANTHROPIC_API_KEY') && { anthropic: { apiKey: env.ANTHROPIC_API_KEY as string } }),
      ...(has('JEV_API_KEY') && { jev: { apiKey: env.JEV_API_KEY as string } }),
      openaiCompatible: {},
    },
    tasks: {
      extract: {
        models: refs,
        prompt: (EXTRACT_PROMPT_VERSIONS as string[]).includes(env.GEMINI_PROMPT ?? '')
          ? (env.GEMINI_PROMPT as AiConfig['tasks']['extract']['prompt'])
          : 'v1',
        textChars: Math.max(200, int('GEMINI_TEXT_CHARS') ?? 6000),
        retriesPerModel: 1,
      },
      reanalyse: { models: refs },
      media: { models: refs },
      judge: judgeOff
        ? { kind: 'off' }
        : { kind: 'jev', model: has('JEV_MODEL') ? (env.JEV_MODEL as string) : 'jev-1.13.0' },
    },
    budget: { dailyUsd: Number(env.AI_DAILY_BUDGET_USD) > 0 ? Number(env.AI_DAILY_BUDGET_USD) : 0 },
    prices: {},
  }
}
