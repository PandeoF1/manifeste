import {
  GEMINI_RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseExtraction,
  type ExtractedEvent,
} from './extraction.ts'
import type { FetchLike, ScrapedItem } from './fetchers/types.ts'

/** Modèle par défaut, surchargeable via GEMINI_MODEL. Vérifié sur ai.google.dev le 2026-10-04. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

export interface GeminiConfig {
  apiKey: string
  model: string
  fetchFn: FetchLike
}

/** Envoie un lot d'éléments à Gemini en sortie structurée JSON et renvoie les événements valides. */
export async function extractEvents(
  config: GeminiConfig,
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
): Promise<ExtractedEvent[]> {
  if (batch.length === 0) return []
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`
  const res = await config.fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(batch) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`Gemini HTTP ${res.status}: ${detail}`)
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  return parseExtraction(json, new Set(batch.map((b) => b.id)))
}
