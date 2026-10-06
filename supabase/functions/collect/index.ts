// Edge Function : collecte automatique des sources (Telegram, RSS, Bluesky) + extraction IA.
// Déclenchée par pg_cron (en-tête x-collect-secret) ou par un admin connecté (bouton "Lancer").
//
// Répartiteur (appel sans corps) :
//   1. découpe les sources en groupes et lance un sous-appel « lecture » par groupe : chacun
//      récupère ses sources et renvoie les éléments nouveaux et pertinents (pas d'IA) ;
//   2. envoie TOUS ces éléments à Gemini par gros lots (en général 1 appel par passage) ;
//   3. rattache aux lycées et enregistre.
// Sous-appel « lecture » : { mode: "gather", source_ids }.
// Une source depuis l'admin : { source_id } (lecture + analyse dans le même appel).
import {
  analyzePending,
  chunk,
  gatherSources,
  mapLimit,
  pendingFromJson,
  pendingToJson,
  type CollectorSource,
  type Pending,
  type PendingJson,
  type SourceRunResult,
} from '../_shared/collector.ts'
import { CERTAINTIES, type Certainty } from '../_shared/extraction.ts'
import { createExtractor, modelsFromEnv } from '../_shared/gemini.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { COLLECT_SECRET, SUPABASE_URL, admin, db, isAuthorized } from '../_shared/service.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODELS = modelsFromEnv(
  Deno.env.get('GEMINI_MODEL'),
  Deno.env.get('GEMINI_FALLBACK_MODELS'),
)
const MIN_CERTAINTY_RAW = Deno.env.get('COLLECT_MIN_CERTAINTY') ?? 'moyenne'
const MIN_CERTAINTY: Certainty = (CERTAINTIES as readonly string[]).includes(MIN_CERTAINTY_RAW)
  ? (MIN_CERTAINTY_RAW as Certainty)
  : 'moyenne'
/** Sources lues par un sous-appel : chacun a son propre budget CPU (2 s) et mémoire. */
const SOURCES_PER_WORKER = Number(Deno.env.get('COLLECT_SOURCES_PER_WORKER') ?? 3)
/** Sous-appels de lecture simultanés. */
const WORKER_CONCURRENCY = Number(Deno.env.get('COLLECT_WORKER_CONCURRENCY') ?? 8)
/** Sources traitées par passage ; les autres (les plus récemment collectées) attendent le suivant. */
const MAX_SOURCES_PER_RUN = Number(Deno.env.get('COLLECT_MAX_SOURCES_PER_RUN') ?? 120)
/** Éléments envoyés à Gemini par requête (le quota compte les requêtes, pas les éléments). */
/**
 * Éléments nouveaux lus par source et par passage (les plus récents) : borne le travail d'un
 * sous-appel (lecture des articles) ; le reste est repris au passage suivant.
 */
const MAX_ITEMS_PER_SOURCE = Number(Deno.env.get('COLLECT_MAX_ITEMS_PER_SOURCE') ?? 20)
const ITEMS_PER_GEMINI_CALL = Number(Deno.env.get('COLLECT_ITEMS_PER_GEMINI_CALL') ?? 60)

const SOURCE_COLUMNS = 'id, kind, identifier, label, source_type'

async function loadSources(ids: string[]): Promise<CollectorSource[]> {
  const { data, error } = await admin
    .from('scrape_sources')
    .select(SOURCE_COLUMNS)
    .in('id', ids)
    .eq('enabled', true)
  if (error) throw new Error(error.message)
  return (data ?? []) as CollectorSource[]
}

async function analyze(pending: Pending[], results: SourceRunResult[], startedAt: number) {
  const extractor = createExtractor({
    apiKey: GEMINI_API_KEY,
    models: GEMINI_MODELS,
    fetchFn: fetch,
  })
  await analyzePending(pending, results, {
    db,
    fetchFn: fetch,
    extract: extractor.extract,
    minCertainty: MIN_CERTAINTY,
    batchSize: ITEMS_PER_GEMINI_CALL,
    budgetMs: 130_000,
    startedAt,
  })
  return {
    results,
    served: [...extractor.served],
    geminiCalls: extractor.calls,
  }
}

/** Sous-appel : lecture seule d'un groupe de sources. */
async function gather(ids: string[]) {
  const { results, pending } = await gatherSources(await loadSources(ids), {
    db,
    fetchFn: fetch,
    maxItemsPerSource: MAX_ITEMS_PER_SOURCE,
  })
  return { results, pending: pending.map(pendingToJson) }
}

/** Répartiteur : lectures en parallèle, puis analyse groupée. */
async function dispatch(startedAt: number) {
  const { data, error } = await admin
    .from('scrape_sources')
    .select('id, label')
    .eq('enabled', true)
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(MAX_SOURCES_PER_RUN)
  if (error) throw new Error(error.message)

  const groups = chunk(data ?? [], SOURCES_PER_WORKER)
  const gathered = await mapLimit(groups, WORKER_CONCURRENCY, async (group) => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/collect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-collect-secret': COLLECT_SECRET },
        body: JSON.stringify({ mode: 'gather', source_ids: group.map((s) => s.id) }),
        signal: AbortSignal.timeout(60_000),
      })
      const body = (await res.json()) as {
        results?: SourceRunResult[]
        pending?: PendingJson[]
        error?: string
      }
      if (!res.ok || !body.results) throw new Error(body.error ?? `HTTP ${res.status}`)
      return { results: body.results, pending: (body.pending ?? []).map(pendingFromJson) }
    } catch (e) {
      // Sous-appel coupé (limite CPU, délai) : signalé sans bloquer les autres groupes.
      const message = `Lecture interrompue : ${e instanceof Error ? e.message : String(e)}`
      return {
        pending: [] as Pending[],
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
          items: [],
        })),
      }
    }
  })

  return analyze(
    gathered.flatMap((g) => g.pending),
    gathered.flatMap((g) => g.results),
    startedAt,
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(await isAuthorized(req))) return json(401, { error: 'unauthorized' })
  if (!GEMINI_API_KEY) return json(500, { error: 'missing_gemini_api_key' })
  if (!COLLECT_SECRET) return json(500, { error: 'missing_collect_secret' })

  const body = (await req.json().catch(() => ({}))) as {
    mode?: unknown
    source_id?: unknown
    source_ids?: unknown
  }
  const ids = Array.isArray(body.source_ids)
    ? body.source_ids.filter((v): v is string => typeof v === 'string').slice(0, 20)
    : null
  const startedAt = Date.now()

  try {
    if (body.mode === 'gather' && ids) return json(200, await gather(ids))

    const { results, served, geminiCalls } =
      typeof body.source_id === 'string'
        ? await (async () => {
            const { results, pending } = await gatherSources(
              await loadSources([body.source_id as string]),
              {
                db,
                fetchFn: fetch,
              },
            )
            return analyze(pending, results, startedAt)
          })()
        : await dispatch(startedAt)

    return json(200, {
      // Modèles réellement utilisés pendant ce passage (ou la liste configurée si aucun appel).
      model: served.length ? served.join(', ') : GEMINI_MODELS.join(' > '),
      gemini_calls: geminiCalls,
      duration_ms: Date.now() - startedAt,
      results,
    })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'erreur inconnue' })
  }
})
