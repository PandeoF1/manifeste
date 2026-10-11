/**
 * Replay: answers from recorded responses, so benchmarks and tests run offline, free and
 * deterministic. A recording is keyed by a hash of (model, system, user, schema).
 *
 *   const store = new Map()                       // or one loaded from a JSON file
 *   const live = recording(geminiModel(...), store)  // first run: calls the model, fills the store
 *   const offline = replayModel('gemini', 'flash-lite', store) // later runs: no network
 */
import { createHash } from 'node:crypto'
import { AiError } from '../errors.ts'
import type { JsonModel, JsonRequest, ModelResult, TokenUsage } from '../types.ts'

export interface Recording {
  json: unknown
  usage: TokenUsage
  latencyMs: number
}
export type RecordingStore = Map<string, Recording>

export function requestKey(model: string, request: JsonRequest): string {
  const payload = JSON.stringify([model, request.system, request.user, request.schema])
  return createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

export function replayModel(provider: string, model: string, store: RecordingStore): JsonModel {
  return {
    provider,
    model,
    async generate(request) {
      const hit = store.get(requestKey(model, request))
      if (!hit)
        throw new AiError('bad-request', provider, `${model}: no recording for this request`)
      return { ...hit, model, provider } satisfies ModelResult
    },
  }
}

/** Calls the wrapped model and records what it answers. */
export function recording(inner: JsonModel, store: RecordingStore): JsonModel {
  return {
    provider: inner.provider,
    model: inner.model,
    async generate(request, signal) {
      const result = await inner.generate(request, signal)
      store.set(requestKey(inner.model, request), {
        json: result.json,
        usage: result.usage,
        latencyMs: result.latencyMs,
      })
      return result
    },
  }
}

export const storeToJson = (store: RecordingStore): string =>
  JSON.stringify(Object.fromEntries(store))

export const storeFromJson = (text: string): RecordingStore =>
  new Map(Object.entries(JSON.parse(text) as Record<string, Recording>))
