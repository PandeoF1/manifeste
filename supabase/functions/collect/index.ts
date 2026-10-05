// Edge Function : collecte automatique des sources (Telegram, RSS, Bluesky) + extraction IA.
// Déclenchée par pg_cron (en-tête x-collect-secret) ou par un admin connecté (bouton "Lancer").
import { createClient } from '@supabase/supabase-js'
import {
  chunk,
  collectSources,
  mapLimit,
  type CollectorDb,
  type CollectorSource,
} from '../_shared/collector.ts'
import { CERTAINTIES, type Certainty } from '../_shared/extraction.ts'
import { createExtractor, modelsFromEnv } from '../_shared/gemini.ts'
import type { SchoolCandidate } from '../_shared/matching.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const COLLECT_SECRET = Deno.env.get('COLLECT_SECRET') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODELS = modelsFromEnv(
  Deno.env.get('GEMINI_MODEL'),
  Deno.env.get('GEMINI_FALLBACK_MODELS'),
)
const MIN_CERTAINTY_RAW = Deno.env.get('COLLECT_MIN_CERTAINTY') ?? 'moyenne'
const MIN_CERTAINTY: Certainty = (CERTAINTIES as readonly string[]).includes(MIN_CERTAINTY_RAW)
  ? (MIN_CERTAINTY_RAW as Certainty)
  : 'moyenne'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function isAuthorized(req: Request): Promise<boolean> {
  if (timingSafeEqual(req.headers.get('x-collect-secret') ?? '', COLLECT_SECRET)) return true
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return false
  const { data } = await admin.auth.getUser(token)
  return data.user?.app_metadata?.role === 'admin'
}

const db: CollectorDb = {
  async seenIds(sourceId, externalIds) {
    if (externalIds.length === 0) return new Set()
    const { data, error } = await admin
      .from('scraped_items')
      .select('external_id')
      .eq('source_id', sourceId)
      .in('external_id', externalIds)
    if (error) throw new Error(`scraped_items: ${error.message}`)
    return new Set(data.map((r) => r.external_id as string))
  },
  async markSeen(sourceId, externalIds) {
    if (externalIds.length === 0) return
    const { error } = await admin.from('scraped_items').upsert(
      externalIds.map((external_id) => ({ source_id: sourceId, external_id })),
      { onConflict: 'source_id,external_id', ignoreDuplicates: true },
    )
    if (error) throw new Error(`scraped_items: ${error.message}`)
  },
  async matchSchool(name, city) {
    const { data, error } = await admin.rpc('match_school', {
      p_name: name,
      p_city: city,
      p_limit: 5,
    })
    if (error) throw new Error(`match_school: ${error.message}`)
    return (data ?? []) as SchoolCandidate[]
  },
  async insertReport(report) {
    const { error } = await admin.from('reports').insert(report)
    if (!error) return 'inserted'
    if (error.code === '23505') return 'duplicate'
    throw new Error(`reports: ${error.message}`)
  },
  async insertUnmatched(row) {
    const { error } = await admin.from('unmatched_extractions').insert(row)
    if (error) throw new Error(`unmatched_extractions: ${error.message}`)
  },
  async recordRun(sourceId, err) {
    await admin
      .from('scrape_sources')
      .update({ last_run_at: new Date().toISOString(), last_error: err })
      .eq('id', sourceId)
  },
}

/** Sources traitées par un sous-appel : chacun a son propre budget CPU (2 s) et mémoire. */
const SOURCES_PER_WORKER = Number(Deno.env.get('COLLECT_SOURCES_PER_WORKER') ?? 4)
/** Sous-appels simultanés (limite aussi les appels parallèles à Gemini). */
const WORKER_CONCURRENCY = Number(Deno.env.get('COLLECT_WORKER_CONCURRENCY') ?? 4)
/** Sources traitées par passage ; les autres (les plus récemment collectées) attendent le suivant. */
const MAX_SOURCES_PER_RUN = Number(Deno.env.get('COLLECT_MAX_SOURCES_PER_RUN') ?? 80)

type RunResult = Awaited<ReturnType<typeof collectSources>>[number]
type WorkResult = { results: RunResult[]; served: string[] }

/** Mode « travailleur » : collecte une liste précise de sources. */
async function work(sourceIds: string[]): Promise<WorkResult> {
  const { data, error } = await admin
    .from('scrape_sources')
    .select('id, kind, identifier, label, source_type')
    .in('id', sourceIds)
    .eq('enabled', true)
  if (error) throw new Error(error.message)
  const extractor = createExtractor({
    apiKey: GEMINI_API_KEY,
    models: GEMINI_MODELS,
    fetchFn: fetch,
  })
  const results = await collectSources((data ?? []) as CollectorSource[], {
    db,
    fetchFn: fetch,
    minCertainty: MIN_CERTAINTY,
    budgetMs: 120_000,
    extract: extractor.extract,
  })
  return { results, served: [...extractor.served] }
}

/**
 * Mode « répartiteur » (cron, bouton « Lancer la collecte ») : découpe les sources en petits
 * groupes et lance un sous-appel par groupe. Le répartiteur ne fait qu'attendre (pas de CPU),
 * la charge est répartie : ajouter des sources n'épuise jamais le budget d'un seul appel.
 */
async function dispatch(): Promise<WorkResult> {
  const { data, error } = await admin
    .from('scrape_sources')
    .select('id, label')
    .eq('enabled', true)
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(MAX_SOURCES_PER_RUN)
  if (error) throw new Error(error.message)
  const groups = chunk(data ?? [], SOURCES_PER_WORKER)
  const nested = await mapLimit(groups, WORKER_CONCURRENCY, async (group) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/collect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-collect-secret': COLLECT_SECRET },
        body: JSON.stringify({ source_ids: group.map((s) => s.id) }),
        signal: AbortSignal.timeout(145_000),
      })
      const body = (await res.json()) as {
        results?: RunResult[]
        served?: string[]
        error?: string
      }
      if (!res.ok || !body.results) throw new Error(body.error ?? `HTTP ${res.status}`)
      return { results: body.results, served: body.served ?? [] }
    } catch (e) {
      // Sous-appel coupé (limite CPU, délai) : on le signale sans bloquer les autres groupes.
      const message = `Sous-appel interrompu : ${e instanceof Error ? e.message : String(e)}`
      return {
        served: [],
        results: group.map((s) => ({
          source_id: s.id,
          label: s.label,
          fetched: 0,
          new_items: 0,
          relevant: 0,
          events: 0,
          reports: 0,
          duplicates: 0,
          unmatched: 0,
          low_certainty: 0,
          error: message,
        })),
      }
    }
  })
  return {
    results: nested.flatMap((n) => n.results),
    served: [...new Set(nested.flatMap((n) => n.served))],
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(await isAuthorized(req))) return json(401, { error: 'unauthorized' })
  if (!GEMINI_API_KEY) return json(500, { error: 'missing_gemini_api_key' })
  if (!COLLECT_SECRET) return json(500, { error: 'missing_collect_secret' })

  const body = (await req.json().catch(() => ({}))) as { source_id?: unknown; source_ids?: unknown }
  const ids = Array.isArray(body.source_ids)
    ? body.source_ids.filter((v): v is string => typeof v === 'string').slice(0, 20)
    : typeof body.source_id === 'string'
      ? [body.source_id]
      : null

  const startedAt = Date.now()
  try {
    const results = ids ? await work(ids) : await dispatch()
    return json(200, {
      model: GEMINI_MODELS.join(' > '),
      duration_ms: Date.now() - startedAt,
      results,
    })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'erreur inconnue' })
  }
})
