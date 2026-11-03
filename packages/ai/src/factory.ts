/** Builds the models, chains and judge of a validated configuration. */
import { createChain, type AiGuard, type Chain } from './chain.ts'
import { allPrices, validateAiConfig, type AiConfig, type ModelRef } from './config.ts'
import { AiError } from './errors.ts'
import type { Judge } from './ports.ts'
import { EXTRACT_PROMPTS } from './prompts/extract.ts'
import { MEDIA_PROMPT_VERSION } from './prompts/media.ts'
import { ROUTES_PROMPT_VERSION } from './prompts/routes.ts'
import { SIGNALS_PROMPT_VERSION } from './prompts/signals.ts'
import { REANALYSE_PROMPT_VERSION } from './prompts/reanalyse.ts'
import { anthropicModel } from './providers/anthropic.ts'
import { geminiModel } from './providers/gemini.ts'
import { jevJudge } from './providers/jev.ts'
import { openAiCompatibleModel } from './providers/openai-compatible.ts'
import { replayModel, type RecordingStore } from './providers/replay.ts'
import { llmJudge } from './tasks/llm-judge.ts'
import type { AiTask, FetchLike, JsonModel, UsageSink } from './types.ts'

export interface AiRuntime {
  fetch?: FetchLike
  sink?: UsageSink
  /** Estimated USD spent today (UTC), for the daily cap. Called before every AI call. */
  spentToday?: () => number
  /** Recordings for models whose provider is `replay`. */
  replay?: RecordingStore
  sleep?: (ms: number) => Promise<void>
}

export function buildModel(config: AiConfig, ref: ModelRef, runtime: AiRuntime = {}): JsonModel {
  const common = { model: ref.model, ...(runtime.fetch && { fetch: runtime.fetch }) }
  switch (ref.provider) {
    case 'gemini':
      return geminiModel({
        ...common,
        apiKey: config.credentials.gemini?.apiKey ?? '',
        ...(ref.thinkingBudget !== undefined && { thinkingBudget: ref.thinkingBudget }),
      })
    case 'anthropic':
      return anthropicModel({ ...common, apiKey: config.credentials.anthropic?.apiKey ?? '' })
    case 'openai-compatible': {
      const server = config.credentials.openaiCompatible[ref.server ?? 'default']
      return openAiCompatibleModel({
        ...common,
        baseUrl: server?.baseUrl ?? '',
        apiKey: server?.apiKey ?? '',
        provider: `openai-compatible/${ref.server ?? 'default'}`,
      })
    }
    case 'replay':
      return replayModel('replay', ref.model, runtime.replay ?? new Map())
  }
}

export function createAi(rawConfig: AiConfig, runtime: AiRuntime = {}) {
  const config = validateAiConfig(rawConfig)
  const prices = allPrices(config)

  const guard: AiGuard = {
    check() {
      if (!config.enabled)
        throw new AiError('disabled', 'config', 'AI is switched off (enabled=false)')
      const cap = config.budget.dailyUsd
      if (cap > 0 && (runtime.spentToday?.() ?? 0) >= cap)
        throw new AiError('budget', 'config', `Daily AI budget of ${cap} USD reached`)
    },
  }

  const chainFor = (
    task: AiTask,
    refs: readonly ModelRef[],
    promptVersion: string,
    retries = 1,
  ): Chain =>
    createChain({
      task,
      promptVersion,
      models: refs.map((ref) => buildModel(config, ref, runtime)),
      retriesPerModel: retries,
      prices,
      guard,
      ...(runtime.sink && { sink: runtime.sink }),
      ...(runtime.sleep && { sleep: runtime.sleep }),
    })

  const extract = config.tasks.extract
  return {
    config,
    /** One chain per run: it remembers which model answered. */
    extractChain: () =>
      chainFor('extract', extract.models, extract.prompt, extract.retriesPerModel),
    reanalyseChain: () =>
      chainFor('reanalyse', config.tasks.reanalyse.models, REANALYSE_PROMPT_VERSION),
    mediaChain: () => chainFor('media', config.tasks.media.models, MEDIA_PROMPT_VERSION),
    /** Route detection shares the media models: same kind of reading task. */
    routesChain: () => chainFor('routes', config.tasks.media.models, ROUTES_PROMPT_VERSION),
    /** Signaled mobilisations share the media models too. */
    signalsChain: () => chainFor('signals', config.tasks.media.models, SIGNALS_PROMPT_VERSION),
    /** null when the judge is switched off. */
    judge(): Judge | null {
      const judge = config.tasks.judge
      if (judge.kind === 'off') return null
      if (judge.kind === 'jev')
        return jevJudge({
          apiKey: config.credentials.jev?.apiKey ?? '',
          model: judge.model,
          prices,
          ...(runtime.fetch && { fetch: runtime.fetch }),
          ...(runtime.sink && { sink: runtime.sink }),
        })
      const first = judge.models[0]
      return llmJudge(chainFor('judge', judge.models, 'v1'), {
        provider: first?.provider ?? 'llm',
        model: first?.model ?? 'unknown',
      })
    },
    extractPrompt: EXTRACT_PROMPTS[extract.prompt],
  }
}

export type Ai = ReturnType<typeof createAi>
