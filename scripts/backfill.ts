/**
 * Rattrapage historique : récupère sur Google Actualités tous les articles depuis le début du
 * mouvement, les met en file d'attente en base (table backfill_queue), puis les fait analyser
 * par l'IA par lots, avec exactement le même traitement que la collecte automatique
 * (rattachement aux lycées, validation, non-rattachés, journal dans l'admin).
 *
 *   npm run backfill -- fetch --since 2026-09-14 [--until 2026-10-05] [--dry-run]
 *   npm run backfill -- process [--rpm 60] [--max-calls 100]
 *   npm run backfill -- media [--rpm 60] [--limit 500]   (analyse des médias des articles en file)
 *   npm run backfill -- media --redo [--model gemini-3.8-flash]   (refait les analyses déjà en base)
 *   npm run backfill -- status
 *   npm run backfill -- retry-errors
 *
 * Variables (dans l'environnement ou dans un fichier .env.backfill à la racine) :
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY,
 *   GEMINI_MODEL et GEMINI_FALLBACK_MODELS (facultatifs, comme pour l'Edge Function).
 *
 * Tout est relançable : la file dédoublonne les articles, `process` reprend où il s'est arrêté
 * et s'arrête proprement quand le quota Gemini du jour est épuisé.
 */
import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  analyzePending,
  type CollectorSource,
  type Pending,
} from '../supabase/functions/_shared/collector.ts'
import { mapLimit } from '../supabase/functions/_shared/collector-utils.ts'
import { enrichItems } from '../supabase/functions/_shared/enrich.ts'
import {
  CERTAINTIES,
  isRelevant,
  type Certainty,
} from '../supabase/functions/_shared/extraction.ts'
import { fetchRss } from '../supabase/functions/_shared/fetchers/rss.ts'
import {
  createExtractor,
  createGeminiClient,
  modelsFromEnv,
} from '../supabase/functions/_shared/gemini.ts'
import {
  isPressItem,
  mediaRequest,
  mediaRows,
  parseMediaAnalyses,
} from '../supabase/functions/_shared/media.ts'
import { canonicalUrl, extractDomain } from '../supabase/functions/_shared/domain.ts'
import { isGoogleNewsUrl } from '../supabase/functions/_shared/fetchers/googlenews.ts'
import { createServiceDb } from '../supabase/functions/_shared/service-db.ts'
import {
  BACKFILL_SOURCE_IDENTIFIER,
  dayFeedUrl,
  dayRange,
  fromQueueRow,
  isQuotaExhausted,
  presetQueries,
  regionalQueries,
  resolveGoogleNewsSlowly,
  settle,
  toQueueRow,
  type QueueRow,
} from './backfill-lib.ts'

if (existsSync('.env.backfill')) process.loadEnvFile('.env.backfill')

/** Articles envoyés à Gemini par requête (comme la collecte). */
const BATCH = 60
/** Tentatives avant de classer un article en erreur. */
const MAX_ATTEMPTS = 3

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} est requis (environnement ou .env.backfill).`)
  return v
}

function supabaseAdmin() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------
// fetch : Google Actualités, jour par jour et requête par requête -> file d'attente.

async function fetchCommand() {
  const since = arg('since') ?? '2026-09-14'
  const until = arg('until') ?? new Date().toISOString().slice(0, 10)
  const dryRun = process.argv.includes('--dry-run')
  const queries = arg('query') ? [arg('query') as string] : presetQueries()
  const days = dayRange(since, until)
  const admin = dryRun ? null : supabaseAdmin()

  console.log(
    `${days.length} jours × ${queries.length} requêtes = ${days.length * queries.length} flux.`,
  )
  const seen = new Set<string>()
  let relevant = 0
  let queued = 0

  const queue = async (rows: QueueRow[]) => {
    relevant += rows.length
    if (!admin || rows.length === 0) return
    const { data, error } = await admin
      .from('backfill_queue')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(`backfill_queue : ${error.message}`)
    queued += data?.length ?? 0
  }
  /** Lit un flux journalier ; renvoie true s'il a atteint le plafond de Google. */
  const readFeed = async (day: string, query: string, label = query): Promise<boolean> => {
    let items
    try {
      items = await fetchRss(fetch, dayFeedUrl(query, day))
    } catch (e) {
      console.warn(`\n  ${day} « ${query} » : ${e instanceof Error ? e.message : e}`)
      return false
    }
    const rows: QueueRow[] = []
    for (const item of items) {
      if (seen.has(item.externalId) || !isRelevant(item.text)) continue
      seen.add(item.externalId)
      rows.push(toQueueRow(item, label))
    }
    await queue(rows)
    process.stdout.write(`\r${day} · ${relevant} articles pertinents, ${queued} nouveaux en file`)
    await sleep(300)
    return items.length >= 100
  }

  const jobs = days.flatMap((day) => queries.map((query) => ({ day, query })))
  const saturated: typeof jobs = []
  await mapLimit(jobs, 3, async (job) => {
    if (await readFeed(job.day, job.query)) saturated.push(job)
  })
  // Jours de pic : Google coupe à 100, on relance ces flux région par région.
  if (saturated.length) {
    console.log(`\n${saturated.length} flux saturés : relance par région…`)
    const regional = saturated.flatMap(({ day, query }) =>
      regionalQueries(query).map((q) => ({ day, query: q, base: query })),
    )
    let stillFull = 0
    await mapLimit(regional, 3, async ({ day, query, base }) => {
      if (await readFeed(day, query, base)) stillFull++
    })
    if (stillFull)
      console.log(
        `\n${stillFull} flux régionaux encore saturés : ajoutez des requêtes plus précises avec --query.`,
      )
  }
  console.log(
    `\n${relevant} articles pertinents distincts${dryRun ? ' (simulation, rien écrit)' : `, ${queued} ajoutés à la file`}.`,
  )
  if (!dryRun) console.log('Suite : npm run backfill -- process')
}

// ---------------------------------------------------------------------------------------------
// process : vide la file par lots de 60, au rythme du quota Gemini.

async function processCommand() {
  const admin = supabaseAdmin()
  const db = createServiceDb(admin)
  const rpm = Number(arg('rpm') ?? 60)
  const maxCalls = Number(arg('max-calls') ?? Infinity)
  const certainty = process.env.COLLECT_MIN_CERTAINTY ?? 'moyenne'
  const minCertainty: Certainty = (CERTAINTIES as readonly string[]).includes(certainty)
    ? (certainty as Certainty)
    : 'moyenne'

  const { data: source, error: sourceError } = await admin
    .from('scrape_sources')
    .select('id, kind, identifier, label, source_type')
    .eq('kind', 'rss')
    .eq('identifier', BACKFILL_SOURCE_IDENTIFIER)
    .single()
  if (sourceError || !source)
    throw new Error(
      'Source de rattrapage introuvable : appliquez les migrations (supabase db push).',
    )

  let quotaHit: string | null = null
  const extractor = createExtractor({
    apiKey: env('GEMINI_API_KEY'),
    models: modelsFromEnv(process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODELS),
    fetchFn: fetch,
  })
  const extract: typeof extractor.extract = async (batch) => {
    try {
      return await extractor.extract(batch)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (isQuotaExhausted(message)) quotaHit = message
      throw e
    }
  }

  let calls = 0
  const totals = { done: 0, reports: 0, unmatched: 0, retry: 0, errors: 0 }
  while (calls < maxCalls) {
    const startedAt = Date.now()
    const { data: rows, error } = await admin
      .from('backfill_queue')
      .select('id, external_id, url, title, publisher_domain, published_at, attempts')
      .eq('status', 'pending')
      .order('published_at', { ascending: true })
      .limit(BATCH)
    if (error) throw new Error(`backfill_queue : ${error.message}`)
    if (!rows?.length) {
      console.log('\nFile vide : rattrapage terminé.')
      break
    }

    // Lien réel de l'article et chapeau, comme la collecte (25 par appel d'enrichissement).
    const items = rows.map(fromQueueRow)
    const enriched = (
      await mapLimit(
        Array.from({ length: Math.ceil(items.length / 25) }, (_, i) =>
          items.slice(i * 25, i * 25 + 25),
        ),
        2,
        (part) => enrichItems(fetch, part),
      )
    ).flat()
    const pending: Pending[] = enriched.map((item) => ({
      source: source as CollectorSource,
      item,
    }))

    const results = await analyzePending(pending, [], {
      db,
      fetchFn: fetch,
      extract,
      minCertainty,
      batchSize: BATCH,
      budgetMs: Number.POSITIVE_INFINITY,
    })
    calls++
    const r = results[0]
    totals.reports += r?.reports ?? 0
    totals.unmatched += r?.unmatched ?? 0

    const outcome = settle(
      rows.map((row) => row.external_id),
      results,
    )
    const now = new Date().toISOString()
    await mapLimit(rows, 8, async (row) => {
      const s = outcome.get(row.external_id)
      if (s?.kind === 'done') {
        totals.done++
        // Le titre n'est plus utile une fois traité : seuls le lien et l'issue restent.
        await admin
          .from('backfill_queue')
          .update({ status: 'done', outcome: s.outcome, title: null, processed_at: now })
          .eq('id', row.id)
      } else {
        const attempts = row.attempts + 1
        const failed = attempts >= MAX_ATTEMPTS && !quotaHit
        if (failed) totals.errors++
        else totals.retry++
        await admin
          .from('backfill_queue')
          .update({
            status: failed ? 'error' : 'pending',
            // Un quota épuisé n'est pas la faute de l'article : pas de tentative consommée.
            attempts: quotaHit ? row.attempts : attempts,
            last_error: (s?.kind === 'retry' ? s.error : 'non traité').slice(0, 500),
          })
          .eq('id', row.id)
      }
    })

    process.stdout.write(
      `\rLot ${calls} · ${totals.done} traités · ${totals.reports} signaux · ${totals.unmatched} non rattachés · ${totals.retry} à reprendre`,
    )
    if (quotaHit) {
      console.log(
        `\nQuota Gemini épuisé (${quotaHit}).\nRelancez « process » plus tard : la file reprend où elle s'est arrêtée.`,
      )
      break
    }
    const wait = 60_000 / rpm - (Date.now() - startedAt)
    if (wait > 0) await sleep(wait)
  }
  console.log(
    `\nModèles utilisés : ${[...extractor.served].join(', ') || 'aucun'} · ${calls} appels Gemini.`,
  )
  await statusCommand()
}

// ---------------------------------------------------------------------------------------------

// media : analyse du traitement médiatique des articles déjà en file (titre + chapeau de la page,
// relus car le texte n'est pas conservé). Relançable : media_done_at marque ce qui est fait, mais
// pas les articles dont la page n'a pas pu être lue (Google limite la résolution des liens) :
// ils sont retentés au passage suivant. Les articles déjà analysés ne sont pas renvoyés à l'IA.

async function mediaCommand() {
  if (process.argv.includes('--redo')) return mediaRedoCommand()
  const admin = supabaseAdmin()
  const rpm = Number(arg('rpm') ?? 60)
  const limit = Number(arg('limit') ?? Infinity)
  const { data: source, error: sourceError } = await admin
    .from('scrape_sources')
    .select('id')
    .eq('kind', 'rss')
    .eq('identifier', BACKFILL_SOURCE_IDENTIFIER)
    .single()
  if (sourceError || !source) throw new Error('Source de rattrapage introuvable (db push ?).')

  const client = createGeminiClient({
    apiKey: env('GEMINI_API_KEY'),
    models: modelsFromEnv(process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODELS),
    fetchFn: fetch,
  })
  const totals = { read: 0, analyzed: 0, skipped: 0, unreadable: 0 }
  let lastId = 0
  let blockedRuns = 0
  while (totals.read < limit) {
    const startedAt = Date.now()
    const { data: rows, error } = await admin
      .from('backfill_queue')
      .select('id, external_id, url, title, publisher_domain, published_at')
      .is('media_done_at', null)
      .in('status', ['done', 'pending'])
      .gt('id', lastId)
      .order('id')
      .limit(25)
    if (error) throw new Error(`backfill_queue : ${error.message}`)
    if (!rows?.length) {
      console.log('\nTous les articles de la file sont analysés.')
      break
    }
    // Lien réel de l'article puis titre + chapeau de la page.
    lastId = Number(rows[rows.length - 1]?.id ?? lastId)
    // Liens Google : un par un, avec pause (Google répond 429 en rafale), puis lecture des pages.
    const queueItems = rows.map(fromQueueRow)
    const { resolved, blocked } = await resolveGoogleNewsSlowly(
      queueItems.filter((i) => isGoogleNewsUrl(i.url)).map((i) => i.url),
      {
        fetchFn: fetch,
        sleep,
        onProgress: (n, total) =>
          process.stdout.write(`\r${totals.read} articles lus · lien ${n}/${total} du lot…      `),
      },
    )
    if (blocked) {
      console.log(
        "\nGoogle Actualités répond toujours « trop de requêtes » après plusieurs attentes. Relance dans une ou deux heures : le script reprend là où il s'est arrêté.",
      )
      break
    }
    const withReal = queueItems.map((i) => {
      const real = resolved.get(i.url)
      return real
        ? {
            ...i,
            url: real,
            publisherDomain: i.publisherDomain ?? extractDomain(real) ?? undefined,
          }
        : i
    })
    const enriched = await enrichItems(
      fetch,
      withReal.filter((i) => !isGoogleNewsUrl(i.url)),
    )
    const byId = new Map(enriched.map((i) => [i.externalId, i]))
    const items = withReal.map((i) => byId.get(i.externalId) ?? i)
    const unreadable = new Set(
      rows.filter((_, i) => (items[i]?.text.trim().length ?? 0) === 0).map((r) => r.id),
    )
    let batch = items
      .map((item, i) => ({ id: String(i), item, source: source as { id: string } }))
      .filter((b) => isPressItem('rss', b.item) && b.item.text.trim().length > 0)
    const known = new Set<string>()
    const urls = batch.map((b) => canonicalUrl(b.item.url))
    for (let i = 0; i < urls.length; i += 25) {
      const { data } = await admin
        .from('media_analyses')
        .select('url')
        .in('url', urls.slice(i, i + 25))
      for (const r of data ?? []) known.add(r.url)
    }
    batch = batch.filter((b) => !known.has(canonicalUrl(b.item.url)))
    totals.read += rows.length
    totals.unreadable += unreadable.size
    // Aucune page lisible sur plusieurs lots de suite : Google limite sans doute les liens. Insister
    // prolongerait le blocage, on s'arrête.
    blockedRuns = unreadable.size === rows.length ? blockedRuns + 1 : 0
    if (blockedRuns >= 3) {
      console.log(
        `\nGoogle Actualités ne résout plus les liens (${totals.unreadable} illisibles de suite). Réessaie dans quelques heures, ou depuis une autre connexion (partage de connexion du téléphone).`,
      )
      break
    }
    totals.skipped += rows.length - batch.length - unreadable.size

    if (batch.length > 0) {
      let analyses
      try {
        analyses = parseMediaAnalyses(await client.generate(mediaRequest(batch)), batch)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.log(`\nGemini : ${message}`)
        if (isQuotaExhausted(message)) {
          console.log('Quota atteint : relancez « media » plus tard (reprise automatique).')
          break
        }
        await sleep(5_000)
        continue
      }
      const out = mediaRows(analyses, batch, [...client.served].at(-1) ?? null)
      if (out.length) {
        const { error: upsertError } = await admin
          .from('media_analyses')
          .upsert(out, { onConflict: 'url', ignoreDuplicates: true })
        if (upsertError) throw new Error(`media_analyses : ${upsertError.message}`)
        totals.analyzed += out.length
      }
    }
    // Page illisible : on ne marque pas, pour la retenter plus tard.
    await admin
      .from('backfill_queue')
      .update({ media_done_at: new Date().toISOString() })
      .in(
        'id',
        rows.filter((r) => !unreadable.has(r.id)).map((r) => r.id),
      )
    process.stdout.write(
      `\r${totals.read} articles lus · ${totals.analyzed} analysés · ${totals.skipped} déjà faits ou hors presse · ${totals.unreadable} illisibles (à retenter)`,
    )
    const wait = 60_000 / rpm - (Date.now() - startedAt)
    if (wait > 0) await sleep(wait)
  }
  console.log(`\nModèles : ${[...client.served].join(', ') || 'aucun'} · ${client.calls} appels.`)
}

// media --redo : refait les analyses déjà en base (nouvelle consigne, meilleur modèle). Les pages
// sont relues (le texte n'est pas conservé). Reprise automatique : une ligne refaite reçoit
// text_chars, celles qui n'en ont pas sont à refaire.
async function mediaRedoCommand() {
  const admin = supabaseAdmin()
  const rpm = Number(arg('rpm') ?? 30)
  const limit = Number(arg('limit') ?? Infinity)
  const model = arg('model') ?? process.env.GEMINI_MODEL
  const client = createGeminiClient({
    apiKey: env('GEMINI_API_KEY'),
    models: modelsFromEnv(model, process.env.GEMINI_FALLBACK_MODELS),
    fetchFn: fetch,
  })
  const totals = { read: 0, redone: 0, skipped: 0 }
  let lastId = '00000000-0000-0000-0000-000000000000'
  while (totals.read < limit) {
    const startedAt = Date.now()
    const { data: rows, error } = await admin
      .from('media_analyses')
      .select('id, url, domain, source_id, published_at')
      .is('text_chars', null)
      .gt('id', lastId)
      .order('id')
      .limit(25)
    if (error) throw new Error(`media_analyses : ${error.message}`)
    if (!rows?.length) {
      console.log('\nToutes les analyses sont refaites.')
      break
    }
    lastId = rows[rows.length - 1]?.id ?? lastId
    const items = await enrichItems(
      fetch,
      rows.map((r) =>
        fromQueueRow({
          external_id: r.url,
          url: r.url,
          title: '',
          publisher_domain: r.domain,
          published_at: r.published_at ?? new Date().toISOString(),
        }),
      ),
    )
    const batch = items
      .map((item, i) => ({
        id: String(i),
        item,
        source: { id: rows[i]?.source_id ?? null },
      }))
      .filter((b) => b.item.text.trim().length > 0)
    totals.read += rows.length
    totals.skipped += rows.length - batch.length

    if (batch.length > 0) {
      let analyses
      try {
        analyses = parseMediaAnalyses(await client.generate(mediaRequest(batch)), batch)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.log(`\nGemini : ${message}`)
        if (isQuotaExhausted(message)) {
          console.log('Quota atteint : relancez « media --redo » plus tard (reprise automatique).')
          break
        }
        await sleep(5_000)
        lastId = '00000000-0000-0000-0000-000000000000'
        continue
      }
      const out = mediaRows(analyses, batch, [...client.served].at(-1) ?? null)
      if (out.length) {
        // Même article : l'adresse (url) est la clé, la nouvelle analyse remplace l'ancienne.
        const { error: upsertError } = await admin.from('media_analyses').upsert(
          out.map((o) => ({ ...o, analyzed_at: new Date().toISOString() })),
          { onConflict: 'url' },
        )
        if (upsertError) throw new Error(`media_analyses : ${upsertError.message}`)
        totals.redone += out.length
      }
    }
    process.stdout.write(
      `\r${totals.read} lus · ${totals.redone} refaites · ${totals.skipped} ignorées (page illisible)`,
    )
    const wait = 60_000 / rpm - (Date.now() - startedAt)
    if (wait > 0) await sleep(wait)
  }
  console.log(`\nModèles : ${[...client.served].join(', ') || 'aucun'} · ${client.calls} appels.`)
}

async function statusCommand() {
  const admin = supabaseAdmin()
  const counts: Record<string, number> = {}
  for (const status of ['pending', 'done', 'error']) {
    const { count, error } = await admin
      .from('backfill_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', status)
    if (error) throw new Error(`backfill_queue : ${error.message}`)
    counts[status] = count ?? 0
  }
  const pending = counts.pending ?? 0
  console.log(
    `File : ${pending} en attente (≈ ${Math.ceil(pending / BATCH)} appels Gemini), ${counts.done} traités, ${counts.error} en erreur.`,
  )
}

async function retryErrorsCommand() {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('backfill_queue')
    .update({ status: 'pending', attempts: 0 })
    .eq('status', 'error')
    .select('id')
  if (error) throw new Error(`backfill_queue : ${error.message}`)
  console.log(`${data?.length ?? 0} articles remis en file.`)
}

const commands: Record<string, () => Promise<void>> = {
  fetch: fetchCommand,
  process: processCommand,
  media: mediaCommand,
  status: statusCommand,
  'retry-errors': retryErrorsCommand,
}
const command = commands[process.argv[2] ?? '']
if (!command) {
  console.log('Usage : npm run backfill -- <fetch|process|media|status|retry-errors> [options]')
  process.exit(1)
}
command().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
