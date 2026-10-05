import { extractDomain } from './domain.ts'
import {
  isRelevant,
  meetsCertainty,
  resolveObservedAt,
  type Certainty,
  type ExtractedEvent,
} from './extraction.ts'
import { fetchSource, type FetchLike, type ScrapedItem } from './fetchers/index.ts'
import { pickMatch, type SchoolCandidate } from './matching.ts'
import type { ScrapeKind } from './sources.ts'
import type { ReportStatus } from './status.ts'

export interface CollectorSource {
  id: string
  kind: ScrapeKind
  identifier: string
  label: string
  source_type: 'presse' | 'syndicat' | 'collecteur'
}

export interface NewReport {
  school_uai: string
  status: ReportStatus
  source_type: CollectorSource['source_type']
  source_url: string
  source_domain: string
  source_id: string
  certainty: Certainty
  observed_at: string
}

export interface NewUnmatched {
  source_id: string
  school_name: string
  city: string | null
  status: ReportStatus
  source_url: string
  observed_at: string
}

/** Accès base de données, injecté (Supabase en prod, faux en test). */
export interface CollectorDb {
  seenIds(sourceId: string, externalIds: string[]): Promise<Set<string>>
  markSeen(sourceId: string, externalIds: string[]): Promise<void>
  matchSchool(name: string, city: string | null): Promise<SchoolCandidate[]>
  insertReport(report: NewReport): Promise<'inserted' | 'duplicate'>
  insertUnmatched(row: NewUnmatched): Promise<void>
  recordRun(sourceId: string, error: string | null): Promise<void>
}

export type Extractor = (
  batch: ReadonlyArray<{ id: string; item: ScrapedItem }>,
) => Promise<ExtractedEvent[]>

export interface CollectorOptions {
  db: CollectorDb
  fetchFn: FetchLike
  extract: Extractor
  now?: Date
  minCertainty?: Certainty
  lookbackHours?: number
  maxItemsPerSource?: number
  batchSize?: number
}

export interface SourceRunResult {
  source_id: string
  label: string
  fetched: number
  new_items: number
  relevant: number
  events: number
  reports: number
  duplicates: number
  unmatched: number
  low_certainty: number
  error: string | null
}

/** Exécute `fn` sur chaque élément avec au plus `limit` appels simultanés (ordre conservé). */
export async function mapLimit<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i] as T, i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function emptyResult(source: CollectorSource): SourceRunResult {
  return {
    source_id: source.id,
    label: source.label,
    fetched: 0,
    new_items: 0,
    relevant: 0,
    events: 0,
    reports: 0,
    duplicates: 0,
    unmatched: 0,
    low_certainty: 0,
    error: null,
  }
}

interface Pending {
  source: CollectorSource
  item: ScrapedItem
}

/**
 * Collecte un groupe de sources :
 * 1. récupération en parallèle (I/O, ne consomme presque pas de CPU) ;
 * 2. les éléments pertinents de TOUTES les sources sont envoyés à l'IA par lots communs
 *    (un appel pour ~20 éléments au lieu d'un appel par source) ;
 * 3. rattachement et insertion.
 * Un élément n'est marqué traité qu'une fois analysé : en cas d'échec de l'IA ou de budget
 * de temps dépassé, il est repris au passage suivant.
 */
export async function collectSources(
  sources: ReadonlyArray<CollectorSource>,
  opts: CollectorOptions & { budgetMs?: number; fetchConcurrency?: number },
): Promise<SourceRunResult[]> {
  const startedAt = Date.now()
  const now = opts.now ?? new Date()
  const minCertainty = opts.minCertainty ?? 'moyenne'
  const lookbackMs = (opts.lookbackHours ?? 48) * 3_600_000
  const batchSize = opts.batchSize ?? 20
  const budgetMs = opts.budgetMs ?? 110_000
  const results = new Map(sources.map((s) => [s.id, emptyResult(s)]))
  const res = (s: CollectorSource) => results.get(s.id) as SourceRunResult

  // 1. Récupération.
  const pending: Pending[] = []
  await mapLimit(sources, opts.fetchConcurrency ?? 4, async (source) => {
    const r = res(source)
    try {
      const fetched = await fetchSource(opts.fetchFn, source.kind, source.identifier)
      r.fetched = fetched.length
      const recent = fetched
        .filter((i) => now.getTime() - i.publishedAt.getTime() <= lookbackMs)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
        .slice(0, opts.maxItemsPerSource ?? 30)
      const seen = await opts.db.seenIds(
        source.id,
        recent.map((i) => i.externalId),
      )
      const fresh = recent.filter((i) => !seen.has(i.externalId))
      r.new_items = fresh.length
      const relevant = fresh.filter((i) => isRelevant(i.text))
      r.relevant = relevant.length
      // Les éléments hors-sujet sont marqués traités tout de suite.
      const irrelevant = fresh.filter((i) => !isRelevant(i.text)).map((i) => i.externalId)
      if (irrelevant.length) await opts.db.markSeen(source.id, irrelevant)
      for (const item of relevant) pending.push({ source, item })
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e)
    }
  })

  // 2 et 3. Extraction par lots communs, puis rattachement.
  for (const group of chunk(pending, batchSize)) {
    if (Date.now() - startedAt > budgetMs) break // repris au prochain passage
    const batch = group.map((p, idx) => ({ id: String(idx), item: p.item, source: p.source }))
    let events: ExtractedEvent[]
    try {
      events = await opts.extract(batch)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      for (const p of group) res(p.source).error = message
      continue
    }
    const byId = new Map(batch.map((b) => [b.id, b]))
    for (const event of events) {
      const entry = byId.get(event.item_id)
      if (!entry) continue
      const r = res(entry.source)
      r.events++
      try {
        await handleEvent(event, entry.item, entry.source, r, minCertainty, opts.db)
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e)
      }
    }
    // Marque traités, par source, les éléments de ce lot.
    const bySource = new Map<string, string[]>()
    for (const p of group)
      bySource.set(p.source.id, [...(bySource.get(p.source.id) ?? []), p.item.externalId])
    for (const [sourceId, ids] of bySource) await opts.db.markSeen(sourceId, ids)
  }

  for (const source of sources) await opts.db.recordRun(source.id, res(source).error)
  return sources.map(res)
}

async function handleEvent(
  event: ExtractedEvent,
  item: ScrapedItem,
  source: CollectorSource,
  r: SourceRunResult,
  minCertainty: Certainty,
  db: CollectorDb,
) {
  if (!meetsCertainty(event.certainty, minCertainty)) {
    r.low_certainty++
    return
  }
  const observedAt = resolveObservedAt(event.observed_at, item.publishedAt).toISOString()
  const candidates = await db.matchSchool(event.school_name, event.city)
  const match = pickMatch(candidates, Boolean(event.city))
  if (!match) {
    r.unmatched++
    await db.insertUnmatched({
      source_id: source.id,
      school_name: event.school_name,
      city: event.city,
      status: event.status,
      source_url: item.url,
      observed_at: observedAt,
    })
    return
  }
  const domain = item.publisherDomain ?? extractDomain(item.url)
  if (!domain) return
  const outcome = await db.insertReport({
    school_uai: match.uai,
    status: event.status,
    source_type: source.source_type,
    source_url: item.url,
    source_domain: domain,
    source_id: source.id,
    certainty: event.certainty,
    observed_at: observedAt,
  })
  if (outcome === 'inserted') r.reports++
  else r.duplicates++
}

/** Une seule source (bouton « collecter maintenant », tests). */
export async function collectSource(
  source: CollectorSource,
  opts: CollectorOptions,
): Promise<SourceRunResult> {
  const [result] = await collectSources([source], opts)
  return result as SourceRunResult
}
