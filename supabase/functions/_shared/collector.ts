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

export async function collectSource(
  source: CollectorSource,
  opts: CollectorOptions,
): Promise<SourceRunResult> {
  const now = opts.now ?? new Date()
  const minCertainty = opts.minCertainty ?? 'moyenne'
  const lookbackMs = (opts.lookbackHours ?? 48) * 3_600_000
  const batchSize = opts.batchSize ?? 15
  const result: SourceRunResult = {
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

  try {
    const fetched = await fetchSource(opts.fetchFn, source.kind, source.identifier)
    result.fetched = fetched.length
    const recent = fetched
      .filter((i) => now.getTime() - i.publishedAt.getTime() <= lookbackMs)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, opts.maxItemsPerSource ?? 30)
    const seen = await opts.db.seenIds(
      source.id,
      recent.map((i) => i.externalId),
    )
    const fresh = recent.filter((i) => !seen.has(i.externalId))
    result.new_items = fresh.length

    const relevant = fresh.filter((i) => isRelevant(i.text))
    result.relevant = relevant.length
    // Les éléments hors-sujet sont marqués traités tout de suite.
    const irrelevantIds = fresh.filter((i) => !isRelevant(i.text)).map((i) => i.externalId)
    if (irrelevantIds.length) await opts.db.markSeen(source.id, irrelevantIds)

    for (let start = 0; start < relevant.length; start += batchSize) {
      const chunk = relevant.slice(start, start + batchSize)
      const batch = chunk.map((item, idx) => ({ id: String(start + idx), item }))
      const byId = new Map(batch.map((b) => [b.id, b.item]))
      // En cas d'échec de l'IA, le lot n'est pas marqué traité : il sera retenté au prochain passage.
      const events = await opts.extract(batch)
      result.events += events.length

      for (const event of events) {
        const item = byId.get(event.item_id)
        if (!item) continue
        if (!meetsCertainty(event.certainty, minCertainty)) {
          result.low_certainty++
          continue
        }
        const observedAt = resolveObservedAt(event.observed_at, item.publishedAt).toISOString()
        const candidates = await opts.db.matchSchool(event.school_name, event.city)
        const match = pickMatch(candidates, Boolean(event.city))
        if (!match) {
          result.unmatched++
          await opts.db.insertUnmatched({
            source_id: source.id,
            school_name: event.school_name,
            city: event.city,
            status: event.status,
            source_url: item.url,
            observed_at: observedAt,
          })
          continue
        }
        const domain = item.publisherDomain ?? extractDomain(item.url)
        if (!domain) continue
        const outcome = await opts.db.insertReport({
          school_uai: match.uai,
          status: event.status,
          source_type: source.source_type,
          source_url: item.url,
          source_domain: domain,
          source_id: source.id,
          certainty: event.certainty,
          observed_at: observedAt,
        })
        if (outcome === 'inserted') result.reports++
        else result.duplicates++
      }
      await opts.db.markSeen(
        source.id,
        chunk.map((i) => i.externalId),
      )
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  await opts.db.recordRun(source.id, result.error)
  return result
}

/**
 * Traite les sources séquentiellement (limite les appels simultanés à l'IA).
 * S'arrête une fois `budgetMs` écoulé : les sources restantes passent au tour suivant
 * (elles sont triées par last_run_at, les plus anciennes d'abord).
 */
export async function collectAll(
  sources: ReadonlyArray<CollectorSource>,
  opts: CollectorOptions,
  budgetMs = 110_000,
): Promise<SourceRunResult[]> {
  const deadline = Date.now() + budgetMs
  const results: SourceRunResult[] = []
  for (const source of sources) {
    if (Date.now() > deadline) break
    results.push(await collectSource(source, opts))
  }
  return results
}
