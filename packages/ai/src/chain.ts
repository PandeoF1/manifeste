/**
 * A model chain: the primary model then fallbacks, with the retry policy that experience with
 * the Gemini free tier taught.
 *
 * - temporary error (5xx, timeout, network): retry the same model, then move on;
 * - quota reached (429) or model closed for the account (404): move on at once, a quota does not
 *   free up in two seconds;
 * - billing (402), invalid key, refused request: stop, no other model will do better;
 * - the model answered with something that is not JSON: next model.
 *
 * The chain is sticky: once a model answers, later calls start with it instead of retrying a
 * saturated one. One chain lives for one run.
 */
import { AiError } from './errors.ts'
import { costOf, type PriceTable } from './pricing.ts'
import {
  addUsage,
  emptyUsage,
  type AiTask,
  type JsonModel,
  type JsonRequest,
  type ModelResult,
  type TokenUsage,
  type UsageSink,
} from './types.ts'

/** Checked before every call: the kill switch and the spending cap live here. */
export interface AiGuard {
  /** Throws an `AiError` of kind `disabled` or `budget` when the call must not happen. */
  check(task: AiTask): void
}

export interface ChainOptions {
  task: AiTask
  promptVersion: string
  /** Primary model first, then fallbacks. */
  models: readonly JsonModel[]
  retriesPerModel?: number
  sleep?: (ms: number) => Promise<void>
  sink?: UsageSink
  prices?: PriceTable
  guard?: AiGuard
}

const SKIP = new Set(['rate-limit', 'not-found', 'invalid-output'])
const TEMPORARY = new Set(['unavailable', 'network'])

export function createChain(options: ChainOptions) {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const retries = options.retriesPerModel ?? 1
  const served = new Set<string>()
  const usage: Record<string, TokenUsage> = {}
  let preferred: JsonModel | null = null
  let calls = 0

  const report = (model: JsonModel, outcome: AiError['kind'] | 'ok', result?: ModelResult) => {
    const used = result?.usage ?? emptyUsage()
    options.sink?.record({
      task: options.task,
      provider: model.provider,
      model: model.model,
      promptVersion: options.promptVersion,
      usage: used,
      latencyMs: result?.latencyMs ?? 0,
      outcome,
      costUsd: options.prices ? costOf(options.prices, model.model, used) : 0,
    })
  }

  const generate = async (request: JsonRequest): Promise<ModelResult> => {
    const ordered = preferred
      ? [preferred, ...options.models.filter((m) => m !== preferred)]
      : options.models
    const failures: string[] = []

    for (const model of ordered) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        options.guard?.check(options.task)
        try {
          const result = await model.generate(request)
          if (result.json === null) {
            report(model, 'invalid-output', result)
            throw new AiError(
              'invalid-output',
              model.provider,
              `${model.model}: the answer is not JSON`,
            )
          }
          report(model, 'ok', result)
          preferred = model
          served.add(result.model)
          usage[result.model] = addUsage(usage[result.model] ?? emptyUsage(), result.usage)
          calls++
          return result
        } catch (e) {
          const error = e instanceof AiError ? e : new AiError('network', model.provider, String(e))
          if (error.kind !== 'invalid-output') report(model, error.kind)
          if (SKIP.has(error.kind)) {
            failures.push(`${model.model}: ${error.kind}`)
            break
          }
          if (!TEMPORARY.has(error.kind)) throw error // billing, auth, bad-request, budget, disabled
          if (attempt < retries) await sleep(1500 * (attempt + 1))
          else failures.push(`${model.model}: ${error.kind}`)
        }
      }
    }
    throw new AiError(
      'unavailable',
      ordered[0]?.provider ?? 'none',
      `No model answered, retry on the next pass. ${failures.join('; ')}`,
    )
  }

  return {
    generate,
    /** Models that answered during this run. */
    served,
    /** Token usage per model, successful calls only. */
    usage,
    get calls() {
      return calls
    },
  }
}

export type Chain = ReturnType<typeof createChain>
