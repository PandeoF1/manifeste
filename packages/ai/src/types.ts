import type { TSchema } from '@sinclair/typebox'

/** A structured-output request: instructions, content and the JSON the answer must follow. */
export interface JsonRequest {
  system: string
  user: string
  /** JSON Schema of the answer (a TypeBox schema is one). Adapters translate it to their dialect. */
  schema: TSchema
  /** Sampling temperature; defaults to 0 because every task here is extraction or classification. */
  temperature?: number
  /** Cap on the generated tokens (thinking included for models that think). Unset: the provider's default. */
  maxOutputTokens?: number
}

/** Tokens consumed. Thinking tokens are billed like output, so they are kept apart. */
export interface TokenUsage {
  calls: number
  promptTokens: number
  /** Generated text, thinking excluded. */
  outputTokens: number
  thoughtsTokens: number
}

export const emptyUsage = (): TokenUsage => ({
  calls: 0,
  promptTokens: 0,
  outputTokens: 0,
  thoughtsTokens: 0,
})

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    calls: a.calls + b.calls,
    promptTokens: a.promptTokens + b.promptTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtsTokens: a.thoughtsTokens + b.thoughtsTokens,
  }
}

/** What one successful model call returns. */
export interface ModelResult {
  /** The parsed JSON, or null when the model did not produce JSON. */
  json: unknown
  usage: TokenUsage
  /** Model that answered (the chain may have fallen back). */
  model: string
  provider: string
  latencyMs: number
}

/** A model that answers a JSON request. One instance is one provider and one model. */
export interface JsonModel {
  readonly provider: string
  readonly model: string
  generate(request: JsonRequest, signal?: AbortSignal): Promise<ModelResult>
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** The tasks that spend AI calls, as accounted in the database. */
export const AI_TASKS = ['extract', 'judge', 'reanalyse', 'media', 'routes'] as const
export type AiTask = (typeof AI_TASKS)[number]

/** One finished call, handed to the usage sink for accounting and traces. */
export interface CallRecord {
  task: AiTask
  provider: string
  model: string
  promptVersion: string
  usage: TokenUsage
  latencyMs: number
  /** `ok`, or the error kind when the call failed. */
  outcome: 'ok' | AiErrorKind
  /** Estimated cost in USD (0 when the price is unknown). */
  costUsd: number
}

export interface UsageSink {
  record(call: CallRecord): void
}

export const AI_ERROR_KINDS = [
  'rate-limit', // 429: quota reached, retrying in seconds will not help
  'unavailable', // 5xx or timeout: temporary
  'not-found', // 404: model closed for this account
  'billing', // 402: credit used up or spending cap hit, lasts for every model
  'auth', // 401/403: invalid key
  'bad-request', // 400: the request is refused as is
  'network',
  'invalid-output', // the model answered, but not with usable JSON
  'budget', // our own spending cap
  'disabled', // kill switch
] as const
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number]
