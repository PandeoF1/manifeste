/** Anthropic Messages API. Structured output is a forced tool call, whose input is the JSON. */
import { httpError, networkError } from '../errors.ts'
import { toJsonSchema } from '../schema.ts'
import type { FetchLike, JsonModel, ModelResult } from '../types.ts'

export interface AnthropicOptions {
  apiKey: string
  model: string
  fetch?: FetchLike
  maxTokens?: number
  timeoutMs?: number
  baseUrl?: string
}

interface MessagesBody {
  content?: Array<{ type: string; input?: unknown }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

export function anthropicModel(options: AnthropicOptions): JsonModel {
  const fetchFn = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? 'https://api.anthropic.com/v1'
  return {
    provider: 'anthropic',
    model: options.model,
    async generate(request, signal) {
      const started = performance.now()
      let res: Response
      try {
        res = await fetchFn(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000),
          body: JSON.stringify({
            model: options.model,
            max_tokens: options.maxTokens ?? 4096,
            temperature: request.temperature ?? 0,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
            tools: [
              {
                name: 'answer',
                description: 'Return the answer in the required structure.',
                input_schema: toJsonSchema(request.schema),
              },
            ],
            tool_choice: { type: 'tool', name: 'answer' },
          }),
        })
      } catch (e) {
        throw networkError('anthropic', options.model, e)
      }
      if (!res.ok) throw await httpError('anthropic', options.model, res)
      const body = (await res.json()) as MessagesBody
      const tool = body.content?.find((c) => c.type === 'tool_use')
      return {
        json: tool?.input ?? null,
        model: options.model,
        provider: 'anthropic',
        latencyMs: Math.round(performance.now() - started),
        usage: {
          calls: 1,
          promptTokens: body.usage?.input_tokens ?? 0,
          outputTokens: body.usage?.output_tokens ?? 0,
          thoughtsTokens: 0,
        },
      } satisfies ModelResult
    },
  }
}
