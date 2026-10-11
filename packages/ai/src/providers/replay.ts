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
import type { FetchLike, JsonModel, JsonRequest, ModelResult, TokenUsage } from '../types.ts'

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

/** One recorded HTTP exchange. Credentials are never part of it. */
export interface RecordedResponse {
  status: number
  body: string
  latencyMs: number
}
export type HttpRecordingStore = Map<string, RecordedResponse>

/** Key of a request: method, URL and body. Headers (and so API keys) are left out on purpose. */
function httpKey(input: string | URL | Request, init?: RequestInit): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return createHash('sha256')
    .update(`${init?.method ?? 'GET'}\n${url}\n${String(init?.body ?? '')}`)
    .digest('hex')
    .slice(0, 24)
}

/**
 * HTTP-level replay: every adapter, Jev included, runs its real code against recorded
 * responses. This is what the benchmarks use offline.
 */
export function replayFetch(store: HttpRecordingStore): FetchLike {
  return async (input, init) => {
    const hit = store.get(httpKey(input, init))
    if (!hit) return new Response('no recording for this request', { status: 599 })
    return new Response(hit.body, {
      status: hit.status,
      headers: {
        'content-type': 'application/json',
        'x-replayed-latency-ms': String(hit.latencyMs),
      },
    })
  }
}

/** Calls the real network and records what comes back, errors included. */
export function recordingFetch(inner: FetchLike, store: HttpRecordingStore): FetchLike {
  return async (input, init) => {
    const started = performance.now()
    const res = await inner(input, init)
    const body = await res.clone().text()
    store.set(httpKey(input, init), {
      status: res.status,
      body,
      latencyMs: Math.round(performance.now() - started),
    })
    return res
  }
}

export const httpStoreToJson = (store: HttpRecordingStore): string =>
  JSON.stringify(Object.fromEntries(store))

export const httpStoreFromJson = (text: string): HttpRecordingStore =>
  new Map(Object.entries(JSON.parse(text) as Record<string, RecordedResponse>))
