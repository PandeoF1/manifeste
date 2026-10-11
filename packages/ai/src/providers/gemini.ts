import { AiError, httpError, networkError } from '../errors.ts'
import { toGeminiSchema } from '../schema.ts'
import type { FetchLike, JsonModel, JsonRequest, ModelResult } from '../types.ts'

export interface GeminiOptions {
  apiKey: string
  model: string
  fetch?: FetchLike
  /**
   * Thinking budget in tokens; 0 turns it off. Flash models think by default and thinking is
   * billed as output, which extraction does not need. Unset: the model's own default.
   */
  thinkingBudget?: number
  timeoutMs?: number
  baseUrl?: string
}

interface GeminiBody {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
  }
}

export function geminiModel(options: GeminiOptions): JsonModel {
  const fetchFn = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
  // A model that refused the thinking setting will always refuse it: stop sending it.
  let thinkingBudget = options.thinkingBudget

  const call = async (request: JsonRequest, signal?: AbortSignal): Promise<ModelResult> => {
    const started = performance.now()
    let res: Response
    try {
      res = await fetchFn(
        `${baseUrl}/models/${encodeURIComponent(options.model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
          signal: signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.user }] }],
            generationConfig: {
              temperature: request.temperature ?? 0,
              responseMimeType: 'application/json',
              responseSchema: toGeminiSchema(request.schema),
              ...(thinkingBudget !== undefined && { thinkingConfig: { thinkingBudget } }),
            },
          }),
        },
      )
    } catch (e) {
      throw networkError('gemini', options.model, e)
    }
    if (!res.ok) throw await httpError('gemini', options.model, res)
    const body = (await res.json()) as GeminiBody
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    const meta = body.usageMetadata
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      // the caller sees null and counts it as an invalid output
    }
    return {
      json,
      model: options.model,
      provider: 'gemini',
      latencyMs: Math.round(performance.now() - started),
      usage: {
        calls: 1,
        promptTokens: meta?.promptTokenCount ?? 0,
        outputTokens: meta?.candidatesTokenCount ?? 0,
        thoughtsTokens: meta?.thoughtsTokenCount ?? 0,
      },
    }
  }

  return {
    provider: 'gemini',
    model: options.model,
    async generate(request, signal) {
      try {
        return await call(request, signal)
      } catch (e) {
        if (e instanceof AiError && e.status === 400 && thinkingBudget !== undefined) {
          thinkingBudget = undefined
          return call(request, signal)
        }
        throw e
      }
    },
  }
}
