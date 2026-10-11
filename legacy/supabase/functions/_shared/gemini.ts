import {
  responseSchema,
  systemPrompt,
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
  /**
   * Budget de réflexion (tokens) : 0 la coupe. Les modèles Flash réfléchissent par défaut et la
   * réflexion est facturée comme de la sortie ; l'extraction n'en a pas besoin. Absent : réglage
   * par défaut du modèle.
   */
  thinkingBudget?: number
  /**
   * Longueur maximale (caractères) du texte de chaque élément envoyé à l'extraction. Absent :
   * DEFAULT_TEXT_CHARS. À baisser seulement après `npm run eval:truncation`.
   */
  textChars?: number
  /** Variante stricte du prompt d'extraction (voir STRICT_RULE). Absent : prompt de base. */
  strictPrompt?: boolean
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

/** Tokens consommés (la réflexion est facturée comme de la sortie). */
export interface TokenUsage {
  calls: number
  promptTokens: number
  /** Texte généré, hors réflexion. */
  outputTokens: number
  /** Tokens de réflexion (thoughtsTokenCount), facturés au tarif de la sortie. */
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

/** Somme d'une consommation par modèle. */
export function totalUsage(byModel: Readonly<Record<string, TokenUsage>>): TokenUsage {
  return Object.values(byModel).reduce(addUsage, emptyUsage())
}

/** Fusionne plusieurs consommations par modèle (extraction + médias, par exemple). */
export function mergeUsage(
  ...parts: ReadonlyArray<Readonly<Record<string, TokenUsage>>>
): Record<string, TokenUsage> {
  const out: Record<string, TokenUsage> = {}
  for (const part of parts)
    for (const [model, u] of Object.entries(part))
      out[model] = addUsage(out[model] ?? emptyUsage(), u)
  return out
}

/** « 12 345 entrée · 2 400 sortie (dont 0 réflexion) », pour les journaux. */
export function formatUsage(u: TokenUsage): string {
  const n = (v: number) => v.toLocaleString('fr-FR')
  const out = u.outputTokens + u.thoughtsTokens
  return `${n(u.promptTokens)} tokens en entrée · ${n(out)} en sortie (dont ${n(u.thoughtsTokens)} de réflexion)`
}

export class GeminiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * 402 : crédit épuisé ou plafond de dépense atteint sur le compte Google. Ça vaut pour tous les
 * modèles et ça dure : inutile d'essayer un modèle de secours ou les lots suivants du passage.
 */
export function isBillingBlocked(e: unknown): boolean {
  return e instanceof GeminiError && e.status === 402
}

const BILLING_MESSAGE =
  'Gemini : crédit épuisé ou plafond de dépense atteint (402). Vérifier la facturation dans Google AI Studio ; repris au prochain passage.'

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

/** Appel d'un modèle ; renvoie le JSON produit (null si la sortie n'est pas du JSON) et la consommation. */
async function callModel(
  config: GeminiConfig,
  model: string,
  request: JsonRequest,
): Promise<{ json: unknown; usage: TokenUsage }> {
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
        ...(config.thinkingBudget !== undefined && {
          thinkingConfig: { thinkingBudget: config.thinkingBudget },
        }),
      },
    }),
  })
  if (!res.ok) {
    const detail = await errorMessage(res)
    throw new GeminiError(
      res.status,
      res.status === 402
        ? `${BILLING_MESSAGE} (${model} : ${detail})`
        : `${model} HTTP ${res.status} : ${detail}`,
    )
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      thoughtsTokenCount?: number
    }
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  const meta = body.usageMetadata
  const usage: TokenUsage = {
    calls: 1,
    promptTokens: meta?.promptTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
    thoughtsTokens: meta?.thoughtsTokenCount ?? 0,
  }
  try {
    return { json: JSON.parse(text), usage }
  } catch {
    return { json: null, usage }
  }
}

/**
 * Requête JSON avec reprise : sur erreur temporaire (503, réseau) nouvelle tentative, sur quota
 * (429) ou modèle fermé (404) modèle suivant. Une erreur définitive (clé invalide, requête
 * refusée, crédit épuisé 402) est remontée immédiatement. Renvoie le JSON, le modèle qui a
 * répondu, sa consommation et si le réglage de réflexion a dû être abandonné (400).
 */
export async function generateJson(
  config: GeminiConfig,
  request: JsonRequest,
): Promise<{ json: unknown; model: string; usage: TokenUsage; thinkingDropped: boolean }> {
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const retries = config.retriesPerModel ?? 1
  const failures: string[] = []
  let thinkingDropped = false

  for (const model of config.models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { json, usage } = await callModel(config, model, request)
        return { json, model, usage, thinkingDropped }
      } catch (e) {
        // Délai dépassé ou réseau : temporaire.
        const status = e instanceof GeminiError ? e.status : 0
        const message = e instanceof Error ? e.message : String(e)
        // Ce modèle refuse le réglage de réflexion : on réessaie sans, une seule fois.
        if (status === 400 && config.thinkingBudget !== undefined) {
          config = { ...config, thinkingBudget: undefined }
          thinkingDropped = true
          attempt--
          continue
        }
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
  const usage: Record<string, TokenUsage> = {}
  let calls = 0
  // Un modèle qui a refusé le réglage de réflexion le refusera toujours : on ne le renvoie plus
  // (sinon chaque appel coûterait une requête en erreur 400 de plus).
  let thinkingBudget = config.thinkingBudget
  const generate = async (request: JsonRequest): Promise<unknown> => {
    const models = preferred
      ? [preferred, ...config.models.filter((m) => m !== preferred)]
      : config.models
    const result = await generateJson({ ...config, thinkingBudget, models }, request)
    if (result.thinkingDropped) thinkingBudget = undefined
    preferred = result.model
    served.add(result.model)
    usage[result.model] = addUsage(usage[result.model] ?? emptyUsage(), result.usage)
    calls++
    return result.json
  }
  return {
    generate,
    served,
    /** Consommation de tokens par modèle, requêtes abouties seulement. */
    usage,
    get calls() {
      return calls
    },
  }
}

export function extractionRequest(
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
  textChars?: number,
  strictPrompt = false,
  nature = false,
): JsonRequest {
  return {
    system: systemPrompt(strictPrompt, nature),
    user: buildUserPrompt(batch, textChars),
    schema: responseSchema(nature),
  }
}

/** Extraction d'un lot d'éléments (faits sur les blocages), sortie validée par zod. */
export async function extractEvents(
  config: GeminiConfig,
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
): Promise<ExtractedEvent[]> {
  if (batch.length === 0) return []
  const { json } = await generateJson(
    config,
    extractionRequest(batch, config.textChars, config.strictPrompt),
  )
  return parseExtraction(json, new Set(batch.map((b) => b.id)))
}

/** Extracteur de la collecte, construit sur le client « collant ». */
export function createExtractor(config: GeminiConfig) {
  const client = createGeminiClient(config)
  const extract = async (
    batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
  ): Promise<ExtractedEvent[]> => {
    if (batch.length === 0) return []
    const json = await client.generate(extractionRequest(batch, config.textChars))
    return parseExtraction(json, new Set(batch.map((b) => b.id)))
  }
  return {
    extract,
    served: client.served,
    usage: client.usage,
    get calls() {
      return client.calls
    },
  }
}

/**
 * Budget de réflexion depuis une variable d'environnement : un entier ≥ 0 est transmis tel quel
 * (0 coupe la réflexion), une valeur absente donne `fallback`, et -1 (ou toute valeur
 * invalide) laisse le réglage par défaut du modèle (`undefined`).
 */
export function thinkingBudgetFromEnv(
  raw: string | undefined,
  fallback?: number,
): number | undefined {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/** Longueur de texte depuis une variable d'environnement (entier ≥ 200), sinon `undefined`. */
export function textCharsFromEnv(raw: string | undefined): number | undefined {
  const n = Number(raw)
  return raw !== undefined && Number.isInteger(n) && n >= 200 ? n : undefined
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
