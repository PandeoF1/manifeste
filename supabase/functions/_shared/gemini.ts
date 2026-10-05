import {
  GEMINI_RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseExtraction,
  type ExtractedEvent,
} from './extraction.ts'
import type { FetchLike, ScrapedItem } from './fetchers/types.ts'

/**
 * Modèle par défaut, surchargeable via GEMINI_MODEL. Flash-Lite : l'extraction est une tâche
 * simple, et c'est le seul modèle dont le quota gratuit tient une collecte toutes les 10 min
 * (15 requêtes/min, 500/jour, contre 5/min et 20/jour pour les Flash).
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'
/**
 * Modèles de secours si le principal est saturé (503), limité (429) ou indisponible pour ce
 * compte (404), surchargeables via GEMINI_FALLBACK_MODELS (liste séparée par des virgules).
 * Modèles stables vérifiés sur ai.google.dev le 2026-10-05.
 */
export const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash']

/** Codes HTTP temporaires : on réessaie le même modèle avant de passer au suivant. */
const RETRYABLE = new Set([500, 502, 503, 504])
/**
 * On passe directement au modèle suivant : modèle fermé pour ce compte (404), ou quota atteint
 * (429 : inutile de réessayer, la limite par minute ou par jour ne se libère pas en 2 s).
 */
const SKIP_MODEL = new Set([404, 429])

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

/** Une requête JSON structurée : consigne, contenu, schéma de sortie. */
export interface JsonRequest {
  system: string
  user: string
  schema: unknown
}

export class GeminiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const UNAVAILABLE_PREFIX = 'Gemini indisponible, repris au prochain passage. '

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

/** Appel d'un modèle ; renvoie le JSON produit (null si la sortie n'est pas du JSON). */
async function callModel(
  config: GeminiConfig,
  model: string,
  request: JsonRequest,
): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const res = await config.fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: request.schema,
      },
    }),
  })
  if (!res.ok)
    throw new GeminiError(res.status, `${model} HTTP ${res.status} : ${await errorMessage(res)}`)
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Requête JSON avec reprise : sur erreur temporaire (503, réseau) nouvelle tentative, sur quota
 * (429) ou modèle fermé (404) modèle suivant. Une erreur définitive (clé invalide, requête
 * refusée) est remontée immédiatement. Renvoie le JSON et le modèle qui a répondu.
 */
export async function generateJson(
  config: GeminiConfig,
  request: JsonRequest,
): Promise<{ json: unknown; model: string }> {
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const retries = config.retriesPerModel ?? 1
  const failures: string[] = []

  for (const model of config.models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return { json: await callModel(config, model, request), model }
      } catch (e) {
        // Délai dépassé ou réseau : temporaire.
        const status = e instanceof GeminiError ? e.status : 0
        const message = e instanceof Error ? e.message : String(e)
        if (SKIP_MODEL.has(status)) {
          failures.push(
            status === 429
              ? `${model} : quota atteint (429)`
              : `${model} : indisponible pour ce compte (404)`,
          )
          break
        }
        if (status !== 0 && !RETRYABLE.has(status)) throw e // clé invalide, requête refusée...
        if (attempt < retries) await sleep(1500 * (attempt + 1))
        else failures.push(status === 503 ? `${model} : saturé (503)` : message)
      }
    }
  }
  throw new Error(`${UNAVAILABLE_PREFIX}${failures.join(' ; ')}`)
}

/**
 * Client « collant » pour une exécution : dès qu'un modèle répond, les requêtes suivantes
 * commencent par lui au lieu de retenter un modèle saturé ou à court de quota.
 * `served` garde les modèles utilisés, `calls` le nombre de requêtes abouties.
 */
export function createGeminiClient(config: GeminiConfig) {
  let preferred: string | null = null
  const served = new Set<string>()
  let calls = 0
  const generate = async (request: JsonRequest): Promise<unknown> => {
    const models = preferred
      ? [preferred, ...config.models.filter((m) => m !== preferred)]
      : config.models
    const { json, model } = await generateJson({ ...config, models }, request)
    preferred = model
    served.add(model)
    calls++
    return json
  }
  return {
    generate,
    served,
    get calls() {
      return calls
    },
  }
}

function extractionRequest(batch: ReadonlyArray<{ id: string; item: ScrapedItem }>): JsonRequest {
  return { system: SYSTEM_PROMPT, user: buildUserPrompt(batch), schema: GEMINI_RESPONSE_SCHEMA }
}

/** Extraction d'un lot d'éléments (faits sur les blocages), sortie validée par zod. */
export async function extractEvents(
  config: GeminiConfig,
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
): Promise<ExtractedEvent[]> {
  if (batch.length === 0) return []
  const { json } = await generateJson(config, extractionRequest(batch))
  return parseExtraction(json, new Set(batch.map((b) => b.id)))
}

/** Extracteur de la collecte, construit sur le client « collant ». */
export function createExtractor(config: GeminiConfig) {
  const client = createGeminiClient(config)
  const extract = async (
    batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
  ): Promise<ExtractedEvent[]> => {
    if (batch.length === 0) return []
    const json = await client.generate(extractionRequest(batch))
    return parseExtraction(json, new Set(batch.map((b) => b.id)))
  }
  return {
    extract,
    served: client.served,
    get calls() {
      return client.calls
    },
  }
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
