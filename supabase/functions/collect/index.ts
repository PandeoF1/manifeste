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
// Mode direct (page /admin/direct) : { trace: true, run_id } ; chaque requête est tracée dans
// collector_trace, que la page affiche en temps réel. Jamais pour les passages planifiés.
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
import { planGroups } from '../_shared/collect-plan.ts'
import { recordAiUsage, usageRows } from '../_shared/ai-usage.ts'
import { canonicalUrl } from '../_shared/domain.ts'
import { CERTAINTIES, type Certainty } from '../_shared/extraction.ts'
import {
  createExtractor,
  createGeminiClient,
  formatUsage,
  mergeUsage,
  modelsFromEnv,
  textCharsFromEnv,
  thinkingBudgetFromEnv,
  totalUsage,
  type TokenUsage,
} from '../_shared/gemini.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { SUPABASE_URL, admin, db, getCollectSecret, isAuthorized } from '../_shared/service.ts'
import { batchByLength, traceSink } from '../_shared/service-db.ts'
import { isPressItem, mediaRows, mediaRequest, parseMediaAnalyses } from '../_shared/media.ts'
import { createTracer, noTracer, tracingFetch, type Tracer } from '../_shared/trace.ts'
import type { FetchLike } from '../_shared/fetchers/types.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODELS = modelsFromEnv(
  Deno.env.get('GEMINI_MODEL'),
  Deno.env.get('GEMINI_FALLBACK_MODELS'),
)
/** Analyse des médias : modèle à part (MEDIA_MODEL), le jugement demande plus que l'extraction. */
const MEDIA_MODELS = modelsFromEnv(
  Deno.env.get('MEDIA_MODEL') || Deno.env.get('GEMINI_MODEL'),
  Deno.env.get('GEMINI_FALLBACK_MODELS'),
)
/**
 * Budget de réflexion de Gemini (facturée comme de la sortie). Extraction : seulement si
 * GEMINI_THINKING_BUDGET est défini (0 la coupe ; -1 ou absent : réglage du modèle). Médias :
 * MEDIA_THINKING_BUDGET, coupée par défaut. Un modèle qui refuse le réglage est rappelé sans.
 */
const THINKING_BUDGET = thinkingBudgetFromEnv(Deno.env.get('GEMINI_THINKING_BUDGET'))
const MEDIA_THINKING_BUDGET = thinkingBudgetFromEnv(Deno.env.get('MEDIA_THINKING_BUDGET'), 0)
/** Longueur maximale du texte envoyé par élément à l'extraction (défaut : 6000). */
const TEXT_CHARS = textCharsFromEnv(Deno.env.get('EXTRACTION_TEXT_CHARS'))
const MIN_CERTAINTY_RAW = Deno.env.get('COLLECT_MIN_CERTAINTY') ?? 'moyenne'
const MIN_CERTAINTY: Certainty = (CERTAINTIES as readonly string[]).includes(MIN_CERTAINTY_RAW)
  ? (MIN_CERTAINTY_RAW as Certainty)
  : 'moyenne'
/** Sources lues par un sous-appel : chacun a son propre budget CPU (2 s) et mémoire. */
const SOURCES_PER_WORKER = Number(Deno.env.get('COLLECT_SOURCES_PER_WORKER') ?? 6)
/** Sous-appels de lecture simultanés. */
const WORKER_CONCURRENCY = Number(Deno.env.get('COLLECT_WORKER_CONCURRENCY') ?? 8)
/** Sources traitées par passage ; les autres (les plus récemment collectées) attendent le suivant. */
const MAX_SOURCES_PER_RUN = Number(Deno.env.get('COLLECT_MAX_SOURCES_PER_RUN') ?? 120)
/**
 * Éléments nouveaux lus par source et par passage (les plus récents) : borne le travail d'un
 * sous-appel (lecture des articles) ; le reste est repris au passage suivant.
 */
const MAX_ITEMS_PER_SOURCE = Number(Deno.env.get('COLLECT_MAX_ITEMS_PER_SOURCE') ?? 40)
/**
 * Recherches Google Actualités par passage : au-delà, Google répond 503 aux serveurs de
 * Supabase. Les autres attendent les passages suivants (les plus anciennes d'abord).
 */
const MAX_GOOGLE_NEWS_PER_RUN = Number(Deno.env.get('COLLECT_MAX_GOOGLE_NEWS_PER_RUN') ?? 6)
/** Éléments envoyés à Gemini par requête (le quota compte les requêtes, pas les éléments). */
const ITEMS_PER_GEMINI_CALL = Number(Deno.env.get('COLLECT_ITEMS_PER_GEMINI_CALL') ?? 60)

/**
 * Analyse des médias : coûteuse (lecture des articles par Gemini), désactivée par défaut.
 * Pour la réactiver : secret MEDIA_ANALYSIS_ENABLED=true, puis redéployer `collect`.
 */
const MEDIA_ENABLED = Deno.env.get('MEDIA_ANALYSIS_ENABLED') === 'true'
/** Articles de presse analysés (traitement médiatique) par passage, et par appel Gemini. */
const MEDIA_PER_RUN = Number(Deno.env.get('COLLECT_MEDIA_PER_RUN') ?? 150)
const MEDIA_PER_CALL = 25
/** Au-delà, on laisse tomber l'analyse des médias pour finir la collecte à temps. */
const MEDIA_DEADLINE_MS = 105_000

const SOURCE_COLUMNS = 'id, kind, identifier, label, source_type'

/** Contexte d'un appel : traceur (mode direct) et `fetch` instrumenté. */
interface Ctx {
  tracer: Tracer
  trace: { run_id: string } | null
  fetchFor(actor: 'collecteur' | 'lecteurs', feeds?: ReadonlySet<string>): FetchLike
}

function makeCtx(runId: string | null): Ctx {
  if (!runId) return { tracer: noTracer, trace: null, fetchFor: () => fetch }
  const tracer = createTracer(runId, traceSink(admin))
  return {
    tracer,
    trace: { run_id: runId },
    fetchFor: (actor, feeds) => tracingFetch(fetch, tracer, actor, feeds),
  }
}

const feedsOf = (sources: ReadonlyArray<CollectorSource>) =>
  new Set(sources.filter((s) => s.kind === 'rss').map((s) => s.identifier))

async function loadSources(ids: string[]): Promise<CollectorSource[]> {
  const { data, error } = await admin
    .from('scrape_sources')
    .select(SOURCE_COLUMNS)
    .in('id', ids)
    .eq('enabled', true)
  if (error) throw new Error(error.message)
  return (data ?? []) as CollectorSource[]
}

async function analyze(
  pending: Pending[],
  results: SourceRunResult[],
  startedAt: number,
  ctx: Ctx,
) {
  const extractor = createExtractor({
    apiKey: GEMINI_API_KEY,
    models: GEMINI_MODELS,
    thinkingBudget: THINKING_BUDGET,
    textChars: TEXT_CHARS,
    fetchFn: ctx.fetchFor('collecteur'),
  })
  await analyzePending(pending, results, {
    db,
    fetchFn: ctx.fetchFor('collecteur'),
    extract: extractor.extract,
    minCertainty: MIN_CERTAINTY,
    batchSize: ITEMS_PER_GEMINI_CALL,
    budgetMs: 130_000,
    startedAt,
    onBatch: (logs) => {
      // Chaque fait extrait part vers la base : rattaché, doublon, non rattaché…
      for (const l of logs) {
        const label = [l.school_name, l.city].filter(Boolean).join(' · ') || l.url
        ctx.tracer.emit({ actor: 'collecteur', target: 'base', phase: 'req', label })
        ctx.tracer.emit({
          actor: 'collecteur',
          target: 'base',
          phase: l.outcome === 'erreur' ? 'err' : 'res',
          label,
          detail: l.outcome,
          status: l.outcome === 'rattache' ? 201 : 200,
        })
      }
    },
  })
  const media = await analyzeMedia(pending, startedAt, ctx)
  return {
    results,
    served: [...extractor.served],
    geminiCalls: extractor.calls + media.calls,
    mediaAnalyzed: media.analyzed,
    usage: { extraction: extractor.usage, media: media.usage },
  }
}

/**
 * Traitement médiatique (admin > Médias) : articles de presse nouveaux, pas encore analysés,
 * dans le temps restant. Ne fait jamais échouer la collecte.
 */
async function analyzeMedia(pending: Pending[], startedAt: number, ctx: Ctx) {
  if (!MEDIA_ENABLED) return { analyzed: 0, calls: 0, usage: {} as Record<string, TokenUsage> }
  try {
    const seen = new Set<string>()
    const press = pending.filter((p) => {
      const key = canonicalUrl(p.item.url)
      if (!isPressItem(p.source.kind, p.item) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (press.length === 0)
      return { analyzed: 0, calls: 0, usage: {} as Record<string, TokenUsage> }
    const done = new Set<string>()
    for (const urls of batchByLength(
      press.map((p) => canonicalUrl(p.item.url)),
      3_000,
      50,
    )) {
      const { data } = await admin.from('media_analyses').select('url').in('url', urls)
      for (const r of data ?? []) done.add(r.url as string)
    }
    const todo = press.filter((p) => !done.has(canonicalUrl(p.item.url))).slice(0, MEDIA_PER_RUN)
    const client = createGeminiClient({
      apiKey: GEMINI_API_KEY,
      models: MEDIA_MODELS,
      thinkingBudget: MEDIA_THINKING_BUDGET,
      fetchFn: ctx.fetchFor('collecteur'),
    })
    let analyzed = 0
    for (const group of chunk(todo, MEDIA_PER_CALL)) {
      if (Date.now() - startedAt > MEDIA_DEADLINE_MS) break
      const batch = group.map((p, i) => ({ id: String(i), item: p.item, source: p.source }))
      const results = parseMediaAnalyses(await client.generate(mediaRequest(batch)), batch)
      const model = [...client.served].at(-1) ?? null
      const rows = mediaRows(results, batch, model)
      if (rows.length) {
        const { error } = await admin
          .from('media_analyses')
          .upsert(rows, { onConflict: 'url', ignoreDuplicates: true })
        if (error) console.error('media_analyses', error.message)
        else analyzed += rows.length
      }
    }
    return { analyzed, calls: client.calls, usage: client.usage }
  } catch (e) {
    console.error('analyse des médias', e instanceof Error ? e.message : e)
    return { analyzed: 0, calls: 0, usage: {} as Record<string, TokenUsage> }
  }
}

/** Sous-appel : lecture seule d'un groupe de sources. */
async function gather(ids: string[], ctx: Ctx) {
  const sources = await loadSources(ids)
  const { results, pending } = await gatherSources(sources, {
    db,
    fetchFn: ctx.fetchFor('lecteurs', feedsOf(sources)),
    maxItemsPerSource: MAX_ITEMS_PER_SOURCE,
  })
  return { results, pending: pending.map(pendingToJson) }
}

/**
 * Supabase limite les appels entre fonctions d'une même chaîne (« Rate limit exceeded for
 * trace … Retry after N ») : on attend le délai indiqué, deux fois au plus.
 */
async function withRateLimitRetry(run: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (e) {
      const err = e as { name?: string; message?: string; retryAfterMs?: number }
      const limited =
        err?.name === 'RateLimitError' || /rate limit exceeded/i.test(err?.message ?? '')
      if (!limited || attempt >= 2) throw e
      const hinted = err.retryAfterMs ?? Number(err.message?.match(/retry after (\d+)/i)?.[1])
      const wait = Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted, 15_000) : 5_000
      await new Promise((r) => setTimeout(r, wait + Math.random() * 500))
    }
  }
}

/** Répartiteur : lectures en parallèle, puis analyse groupée. */
async function dispatch(startedAt: number, ctx: Ctx) {
  const { data, error } = await admin
    .from('scrape_sources')
    .select('id, label, identifier')
    .eq('enabled', true)
    .order('last_run_at', { ascending: true, nullsFirst: true })
    .limit(MAX_SOURCES_PER_RUN)
  if (error) throw new Error(error.message)

  const groups = planGroups(data ?? [], SOURCES_PER_WORKER, MAX_GOOGLE_NEWS_PER_RUN)
  ctx.tracer.emit({
    actor: 'collecteur',
    target: 'collecteur',
    phase: 'start',
    label: `${groups.flat().length} sources`,
    n: groups.flat().length,
    detail: `${groups.length} lecteurs, ${WORKER_CONCURRENCY} en parallèle`,
  })
  const call = ctx.fetchFor('collecteur')
  const secret = await getCollectSecret()
  const gathered = await mapLimit(groups, WORKER_CONCURRENCY, async (group) => {
    try {
      const res = await withRateLimitRetry(() =>
        call(`${SUPABASE_URL}/functions/v1/collect`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-collect-secret': secret },
          body: JSON.stringify({
            mode: 'gather',
            source_ids: group.map((s) => s.id),
            ...ctx.trace,
          }),
          signal: AbortSignal.timeout(60_000),
        }),
      )
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
    ctx,
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (!(await isAuthorized(req))) return json(401, { error: 'unauthorized' })
  if (!GEMINI_API_KEY) return json(500, { error: 'missing_gemini_api_key' })
  if (!(await getCollectSecret())) return json(500, { error: 'missing_collect_secret' })

  const body = (await req.json().catch(() => ({}))) as {
    mode?: unknown
    source_id?: unknown
    source_ids?: unknown
    run_id?: unknown
  }
  const ids = Array.isArray(body.source_ids)
    ? body.source_ids.filter((v): v is string => typeof v === 'string').slice(0, 20)
    : null
  const runId =
    typeof body.run_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.run_id) ? body.run_id : null
  const ctx = makeCtx(runId)
  const startedAt = Date.now()

  try {
    if (body.mode === 'gather' && ids) {
      const out = await gather(ids, ctx)
      await ctx.tracer.flush()
      return json(200, out)
    }

    const { results, served, geminiCalls, mediaAnalyzed, usage } =
      typeof body.source_id === 'string'
        ? await (async () => {
            const sources = await loadSources([body.source_id as string])
            ctx.tracer.emit({
              actor: 'collecteur',
              target: 'collecteur',
              phase: 'start',
              label: sources[0]?.label ?? '1 source',
              n: sources.length,
            })
            const { results, pending } = await gatherSources(sources, {
              db,
              fetchFn: ctx.fetchFor('collecteur', feedsOf(sources)),
            })
            return analyze(pending, results, startedAt, ctx)
          })()
        : await dispatch(startedAt, ctx)

    const byModel = mergeUsage(usage.extraction, usage.media)
    const tokens = totalUsage(byModel)
    // Une ligne par passage dans les logs de la fonction : consommation par tâche et par modèle.
    if (tokens.calls > 0)
      console.log(
        JSON.stringify({
          event: 'gemini_usage',
          extraction: totalUsage(usage.extraction),
          media: totalUsage(usage.media),
          by_model: byModel,
        }),
      )
    await recordAiUsage(admin, [
      ...usageRows('extraction', usage.extraction),
      ...usageRows('media', usage.media),
    ])
    const sum = (k: 'reports' | 'unmatched' | 'relevant') =>
      results.reduce((acc, r) => acc + r[k], 0)
    ctx.tracer.emit({
      actor: 'collecteur',
      target: 'collecteur',
      phase: 'end',
      label: `${sum('reports')} signaux`,
      n: sum('reports'),
      ms: Date.now() - startedAt,
      detail: `${sum('relevant')} pertinents · ${sum('unmatched')} non rattachés · ${mediaAnalyzed} articles analysés (médias) · ${geminiCalls} appels Gemini · ${formatUsage(tokens)}`,
    })
    await ctx.tracer.flush()

    return json(200, {
      // Modèles réellement utilisés pendant ce passage (ou la liste configurée si aucun appel).
      model: served.length ? served.join(', ') : GEMINI_MODELS.join(' > '),
      gemini_calls: geminiCalls,
      tokens: {
        prompt: tokens.promptTokens,
        output: tokens.outputTokens,
        thoughts: tokens.thoughtsTokens,
        by_model: byModel,
      },
      media_analyzed: mediaAnalyzed,
      duration_ms: Date.now() - startedAt,
      results,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'erreur inconnue'
    ctx.tracer.emit({
      actor: 'collecteur',
      target: 'collecteur',
      phase: 'end',
      label: 'échec',
      detail: message.slice(0, 200),
      ms: Date.now() - startedAt,
    })
    await ctx.tracer.flush()
    return json(500, { error: message })
  }
})
