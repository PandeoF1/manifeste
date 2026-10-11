import type { FetchLike, JsonModel, JsonRequest, ModelResult } from '../src/index.ts'
import { AiError, Strict } from '../src/index.ts'
import { Type as t } from '@sinclair/typebox'

export interface SeenRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** A fetch that answers from a queue of responses and remembers what it was asked. */
export function fakeFetch(...responses: Array<Response | Error>): {
  fetch: FetchLike
  seen: SeenRequest[]
} {
  const seen: SeenRequest[] = []
  const queue = [...responses]
  const fetch: FetchLike = async (input, init) => {
    seen.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? '{}')),
    })
    const next = queue.shift()
    if (!next) throw new Error('fakeFetch: no response left')
    if (next instanceof Error) throw next
    return next
  }
  return { fetch, seen }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const request: JsonRequest = {
  system: 'system',
  user: 'user',
  schema: Strict({ answer: t.String(), score: t.Union([t.Number(), t.Null()]) }),
}

const usage = { calls: 1, promptTokens: 10, outputTokens: 5, thoughtsTokens: 0 }

/** A scripted model: each call pops an outcome (a JSON value, null, or an error kind). */
export function scripted(
  model: string,
  ...script: Array<unknown | AiError>
): JsonModel & { calls: number } {
  const queue = [...script]
  const m = {
    provider: 'test',
    model,
    calls: 0,
    async generate(): Promise<ModelResult> {
      m.calls++
      const next = queue.length > 1 ? queue.shift() : queue[0]
      if (next instanceof AiError) throw next
      return { json: next, usage, model, provider: 'test', latencyMs: 1 }
    },
  }
  return m
}

export const fail = (kind: ConstructorParameters<typeof AiError>[0], status?: number) =>
  new AiError(kind, 'test', `${kind}`, status)

export const noSleep = async () => {}

/** Element `i` of a list, or a clear failure (tests avoid non-null assertions). */
export function at<T>(list: readonly T[], i = 0): T {
  const value = list[i]
  if (value === undefined) throw new Error(`expected an element at index ${i}`)
  return value
}
