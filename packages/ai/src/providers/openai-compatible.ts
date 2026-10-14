/**
 * Any server that speaks the OpenAI chat-completions API with structured outputs: OpenAI,
 * OpenRouter, Mistral, Groq, a local vLLM or Ollama. Set `baseUrl` and the key.
 */
import { httpError, networkError } from '../errors.ts'
import { toJsonSchema } from '../schema.ts'
import type { FetchLike, JsonModel } from '../types.ts'

export interface OpenAiCompatibleOptions {
  apiKey: string
  model: string
  baseUrl: string
  /** Name shown in accounting; defaults to "openai-compatible". */
  provider?: string
  fetch?: FetchLike
  timeoutMs?: number
  /** Servers that do not support `json_schema` response format fall back to `json_object`. */
  schemaMode?: 'json_schema' | 'json_object'
}

interface ChatBody {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
}

export function openAiCompatibleModel(options: OpenAiCompatibleOptions): JsonModel {
  const fetchFn = options.fetch ?? fetch
  const provider = options.provider ?? 'openai-compatible'
  const mode = options.schemaMode ?? 'json_schema'
  return {
    provider,
    model: options.model,
    async generate(request, signal) {
      const started = performance.now()
      const schema = toJsonSchema(request.schema)
      const system =
        mode === 'json_object'
          ? `${request.system}\n\nAnswer with a single JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`
          : request.system
      let res: Response
      try {
        res = await fetchFn(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          signal: signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000),
          body: JSON.stringify({
            model: options.model,
            temperature: request.temperature ?? 0,
            ...(request.maxOutputTokens !== undefined && { max_tokens: request.maxOutputTokens }),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: request.user },
            ],
            response_format:
              mode === 'json_object'
                ? { type: 'json_object' }
                : { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } },
          }),
        })
      } catch (e) {
        throw networkError(provider, options.model, e)
      }
      if (!res.ok) throw await httpError(provider, options.model, res)
      const body = (await res.json()) as ChatBody
      const text = body.choices?.[0]?.message?.content ?? ''
      let json: unknown = null
      try {
        json = JSON.parse(text)
      } catch {
        // invalid output, see above
      }
      const reasoning = body.usage?.completion_tokens_details?.reasoning_tokens ?? 0
      return {
        json,
        model: options.model,
        provider,
        latencyMs: Math.round(performance.now() - started),
        usage: {
          calls: 1,
          promptTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: Math.max(0, (body.usage?.completion_tokens ?? 0) - reasoning),
          thoughtsTokens: reasoning,
        },
      }
    },
  }
}
