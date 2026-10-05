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
 * Modèles de secours si le principal est saturé (503), limité (429) ou indisponible pour ce
 * compte (404), surchargeables via GEMINI_FALLBACK_MODELS (liste séparée par des virgules).
 * Modèles stables vérifiés sur ai.google.dev le 2026-10-05 (la famille 2.5 n'est plus ouverte
 * aux nouveaux comptes).
 */
export const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
]

/** Codes HTTP temporaires : on réessaie le même modèle avant de passer au suivant. */
const RETRYABLE = new Set([429, 500, 502, 503, 504])
/** Modèle inconnu ou fermé pour ce compte : on passe directement au suivant. */
const SKIP_MODEL = new Set([404])

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
  const failures: string[] = []

  for (const model of config.models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await callModel(config, model, batch)
      } catch (e) {
        // Délai dépassé ou réseau : temporaire.
        const status = e instanceof GeminiError ? e.status : 0
        const message = e instanceof Error ? e.message : String(e)
        if (SKIP_MODEL.has(status)) {
          failures.push(`${model} : indisponible pour ce compte (404)`)
          break
        }
        if (status !== 0 && !RETRYABLE.has(status)) throw e // clé invalide, requête refusée...
        if (attempt < retries) {
          await sleep(1500 * (attempt + 1))
        } else {
          failures.push(
            status === 503
              ? `${model} : saturé (503)`
              : status === 429
                ? `${model} : quota atteint (429)`
                : message,
          )
        }
      }
    }
  }
  throw new Error(`Gemini indisponible, repris au prochain passage. ${failures.join(' ; ')}`)
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
