// Logique pure du rattrapage historique (voir scripts/backfill.ts), testée dans tests/backfill.test.ts.
import type { SourceRunResult } from '../supabase/functions/_shared/collector.ts'
import {
  buildBatchBody,
  googleNewsArticleId,
  parseBatchResponse,
  parseDecodingParams,
} from '../supabase/functions/_shared/fetchers/googlenews.ts'
import type { FetchLike, ScrapedItem } from '../supabase/functions/_shared/fetchers/types.ts'
import { SOURCE_PRESETS } from '../supabase/functions/_shared/sources.ts'

/** Identifiant de la source technique créée par la migration backfill_queue. */
export const BACKFILL_SOURCE_IDENTIFIER =
  'https://news.google.com/rss/search?q=manifeste-rattrapage'

/** Jours (AAAA-MM-JJ, UTC) de `since` à `until` inclus. */
export function dayRange(since: string, until: string): string[] {
  const start = parseDay(since)
  const end = parseDay(until)
  if (start > end) throw new Error(`--since (${since}) est après --until (${until}).`)
  const days: string[] = []
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10))
  return days
}

function parseDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Date invalide « ${day} » (AAAA-MM-JJ).`)
  const t = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(t)) throw new Error(`Date invalide « ${day} ».`)
  return t
}

/** Requêtes de recherche des préréglages Google Actualités, sans la fenêtre « when:1d ». */
export function presetQueries(): string[] {
  const queries = SOURCE_PRESETS.filter(
    (p) => p.kind === 'rss' && p.identifier.startsWith('https://news.google.com/rss/search'),
  )
    .map((p) => new URL(p.identifier).searchParams.get('q') ?? '')
    .map((q) => q.replace(/\s*when:\S+/g, '').trim())
    .filter(Boolean)
  return [...new Set(queries)]
}

/**
 * Flux Google Actualités d'une requête limitée à une journée. Google renvoie au plus
 * 100 articles par flux : découper jour par jour garde l'essentiel même les jours de pic.
 */
export function dayFeedUrl(query: string, day: string): string {
  const next = new Date(parseDay(day) + 86_400_000).toISOString().slice(0, 10)
  const q = `${query} after:${day} before:${next}`
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`
}

/**
 * Jours de pic : un flux qui sature à 100 est relancé une fois par région, pour aller
 * chercher les articles que Google a coupés (presse régionale surtout).
 */
export const REGIONS = [
  'Île-de-France',
  'Auvergne-Rhône-Alpes',
  'Hauts-de-France',
  'Grand Est',
  'Occitanie',
  'Nouvelle-Aquitaine',
  'Provence-Alpes-Côte d’Azur',
  'Bretagne',
  'Pays de la Loire',
  'Normandie',
  'Bourgogne-Franche-Comté',
  'Centre-Val de Loire',
  'Corse',
  'Outre-mer',
] as const

export function regionalQueries(query: string): string[] {
  return REGIONS.map((region) => `${query} "${region}"`)
}

export interface QueueRow {
  external_id: string
  url: string
  title: string
  publisher_domain: string | null
  published_at: string
  query: string
}

export function toQueueRow(item: ScrapedItem, query: string): QueueRow {
  return {
    external_id: item.externalId,
    url: item.url,
    title: item.text.slice(0, 1000),
    publisher_domain: item.publisherDomain ?? null,
    published_at: item.publishedAt.toISOString(),
    query,
  }
}

export function fromQueueRow(row: {
  external_id: string
  url: string
  title: string | null
  publisher_domain: string | null
  published_at: string
}): ScrapedItem {
  return {
    externalId: row.external_id,
    url: row.url,
    text: row.title ?? '',
    publishedAt: new Date(row.published_at),
    publisherDomain: row.publisher_domain ?? undefined,
  }
}

export type Settlement = { kind: 'done'; outcome: string } | { kind: 'retry'; error: string }

/**
 * Devenir de chaque élément d'un lot d'après le journal du collecteur. Un élément peut
 * produire plusieurs faits (plusieurs lycées) : on garde la liste de leurs issues.
 * Erreur (IA, base) ou élément absent du journal : à reprendre.
 */
export function settle(
  externalIds: ReadonlyArray<string>,
  results: ReadonlyArray<SourceRunResult>,
): Map<string, Settlement> {
  const logs = results.flatMap((r) => r.items)
  const out = new Map<string, Settlement>()
  for (const id of externalIds) {
    const mine = logs.filter((l) => l.external_id === id)
    // Un lycée déjà inséré ne sera pas dupliqué à la reprise (contrainte unique sur reports).
    const failed = mine.find((l) => l.outcome === 'erreur')
    if (failed) out.set(id, { kind: 'retry', error: failed.detail ?? 'erreur' })
    else if (mine.length === 0 || mine.every((l) => l.outcome === 'reporte'))
      out.set(id, { kind: 'retry', error: 'non traité' })
    else out.set(id, { kind: 'done', outcome: [...new Set(mine.map((l) => l.outcome))].join(',') })
  }
  return out
}

/** Erreur de quota épuisé sur tous les modèles : inutile d'insister avant le lendemain. */
export function isQuotaExhausted(message: string): boolean {
  return /\b429\b|\b402\b|RESOURCE_EXHAUSTED|quota|crédit épuisé/i.test(message)
}

// ---------------------------------------------------------------------------------------------
// Résolution lente des liens Google Actualités (rattrapage des médias).
// Le service de décodage de Google répond « 429 » dès qu'on l'interroge en rafale : ici, un
// article à la fois, avec une pause, et une attente plus longue quand Google dit stop.

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute'

export interface SlowResolveOptions {
  fetchFn: FetchLike
  sleep: (ms: number) => Promise<void>
  /** Pause entre deux articles (ms, ± 40 %). */
  pauseMs?: number
  /** Attente quand Google répond 429 (ms). */
  backoffMs?: number
  /** Attentes successives avant d'abandonner (Google est alors considéré comme bloquant). */
  maxBackoffs?: number
  onProgress?: (done: number, total: number) => void
}

export interface SlowResolveResult {
  resolved: Map<string, string>
  /** Google refuse toujours après les attentes : inutile d'insister. */
  blocked: boolean
}

export async function resolveGoogleNewsSlowly(
  urls: ReadonlyArray<string>,
  opts: SlowResolveOptions,
): Promise<SlowResolveResult> {
  const { fetchFn, sleep } = opts
  const pauseMs = opts.pauseMs ?? 2_500
  const backoffMs = opts.backoffMs ?? 90_000
  const maxBackoffs = opts.maxBackoffs ?? 3
  const resolved = new Map<string, string>()
  let done = 0

  for (const url of urls) {
    const id = googleNewsArticleId(url)
    if (id) {
      let backoffs = 0
      for (;;) {
        const outcome = await resolveOne(fetchFn, id)
        if (outcome.kind === 'ok') {
          resolved.set(url, outcome.url)
          break
        }
        if (outcome.kind === 'failed') break
        // 429 : on attend, puis on réessaie ce même article.
        if (backoffs >= maxBackoffs) return { resolved, blocked: true }
        backoffs++
        await sleep(backoffMs)
      }
      await sleep(Math.round(pauseMs * (0.6 + Math.random() * 0.8)))
    }
    opts.onProgress?.(++done, urls.length)
  }
  return { resolved, blocked: false }
}

type ResolveOutcome = { kind: 'ok'; url: string } | { kind: 'limited' } | { kind: 'failed' }

async function resolveOne(fetchFn: FetchLike, id: string): Promise<ResolveOutcome> {
  try {
    const page = await fetchFn(`https://news.google.com/rss/articles/${id}`, {
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html',
        'accept-language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (page.status === 429) return { kind: 'limited' }
    if (!page.ok) return { kind: 'failed' }
    const html = await page.text()
    const params = parseDecodingParams(id, html.slice(-150_000)) ?? parseDecodingParams(id, html)
    if (!params) return { kind: 'failed' }
    const res = await fetchFn(BATCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': BROWSER_UA,
        origin: 'https://news.google.com',
        referer: 'https://news.google.com/',
      },
      body: buildBatchBody([params]),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 429) return { kind: 'limited' }
    if (!res.ok) return { kind: 'failed' }
    const [real] = parseBatchResponse(await res.text(), 1)
    return real ? { kind: 'ok', url: real } : { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}
