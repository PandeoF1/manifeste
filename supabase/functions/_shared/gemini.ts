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
/**
 * Modèles de secours si le principal est saturé (503) ou limité (429), surchargeables via
 * GEMINI_FALLBACK_MODELS (liste séparée par des virgules). Identifiants vérifiés sur ai.google.dev.
 */
export const DEFAULT_FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash']

/** Codes HTTP temporaires : on réessaie puis on change de modèle. */
const RETRYABLE = new Set([429, 500, 502, 503, 504])

export interface GeminiConfig {
  apiKey: string
  /** Modèle principal puis modèles de secours, dans l'ordre. */
  models: string[]
  fetchFn: FetchLike
  /** Nouvelles tentatives par modèle sur erreur temporaire (défaut 1). */
  retriesPerModel?: number
  /** Attente avant nouvelle tentative (injectable pour les tests). */
  sleep?: (ms: number) => Promise<void>
}

export class GeminiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Message lisible à partir de la réponse d'erreur JSON de Gemini. */
async function errorMessage(res: Response): Promise<string> {
  const raw = await res.text()
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message.slice(0, 200)
  } catch {
    // réponse non JSON
  }
  return raw.slice(0, 200)
}

async function callModel(
  config: GeminiConfig,
  model: string,
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
): Promise<ExtractedEvent[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const res = await config.fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
    signal: AbortSignal.timeout(45_000),
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
  if (!res.ok)
    throw new GeminiError(res.status, `${model} HTTP ${res.status} : ${await errorMessage(res)}`)
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

/**
 * Envoie un lot d'éléments à Gemini en sortie structurée JSON et renvoie les événements valides.
 * Sur erreur temporaire (modèle saturé, quota) : nouvelle tentative, puis modèle de secours.
 * Une erreur définitive (clé invalide, requête refusée) est remontée immédiatement.
 */
export async function extractEvents(
  config: GeminiConfig,
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
): Promise<ExtractedEvent[]> {
  if (batch.length === 0) return []
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const retries = config.retriesPerModel ?? 1
  let lastError: Error | null = null

  for (const model of config.models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await callModel(config, model, batch)
      } catch (e) {
        const temporary = !(e instanceof GeminiError) || RETRYABLE.has(e.status) // délai dépassé, réseau : temporaire
        lastError = e instanceof Error ? e : new Error(String(e))
        if (!temporary) throw lastError
        if (attempt < retries) await sleep(1500 * (attempt + 1))
      }
    }
  }
  throw new Error(
    `Gemini indisponible (${config.models.join(', ')}). ${lastError?.message ?? ''}`.trim(),
  )
}

/** Liste des modèles depuis l'environnement : principal puis secours, sans doublon. */
export function modelsFromEnv(
  primary: string | undefined,
  fallbacks: string | undefined,
): string[] {
  const list = [
    primary || DEFAULT_GEMINI_MODEL,
    ...(fallbacks !== undefined
      ? fallbacks.split(',').map((m) => m.trim())
      : DEFAULT_FALLBACK_MODELS),
  ].filter(Boolean)
  return [...new Set(list)]
}
