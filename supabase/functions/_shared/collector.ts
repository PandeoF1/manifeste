import { extractDomain } from './domain.ts'
import {
  isRelevant,
  meetsCertainty,
  resolveObservedAt,
  type Certainty,
  type ExtractedEvent,
} from './extraction.ts'
import { fetchSource, type FetchLike, type ScrapedItem } from './fetchers/index.ts'
import { isGenericSchoolName, pickMatch, type SchoolCandidate } from './matching.ts'
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
  /** Domaine de l'éditeur réel (utile pour Google Actualités). */
  source_domain: string | null
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
  /** Lycées de la commune (au plus 2 suffisent pour savoir s'il y en a un seul). */
  schoolsInCity(city: string): Promise<Array<{ uai: string }>>
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

export interface Pending {
  source: CollectorSource
  item: ScrapedItem
}

/** Forme JSON d'un élément en attente (échange entre sous-appels et répartiteur). */
export interface PendingJson {
  source: CollectorSource
  item: Omit<ScrapedItem, 'publishedAt'> & { publishedAt: string }
}

export function pendingToJson(p: Pending): PendingJson {
  return { source: p.source, item: { ...p.item, publishedAt: p.item.publishedAt.toISOString() } }
}

export function pendingFromJson(p: PendingJson): Pending {
  return { source: p.source, item: { ...p.item, publishedAt: new Date(p.item.publishedAt) } }
}

type GatherOptions = Pick<
  CollectorOptions,
  'db' | 'fetchFn' | 'now' | 'lookbackHours' | 'maxItemsPerSource'
> & { fetchConcurrency?: number }

/**
 * Phase 1 : récupère les sources en parallèle (I/O, peu de CPU) et garde les éléments
 * nouveaux et pertinents. Les éléments hors-sujet sont marqués traités tout de suite.
 */
export async function gatherSources(
  sources: ReadonlyArray<CollectorSource>,
  opts: GatherOptions,
): Promise<{ results: SourceRunResult[]; pending: Pending[] }> {
  const now = opts.now ?? new Date()
  const lookbackMs = (opts.lookbackHours ?? 48) * 3_600_000
  const results = sources.map(emptyResult)
  const pending: Pending[] = []
  await mapLimit(sources, opts.fetchConcurrency ?? 4, async (source, index) => {
    const r = results[index] as SourceRunResult
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
      const irrelevant = fresh.filter((i) => !isRelevant(i.text)).map((i) => i.externalId)
      if (irrelevant.length) await opts.db.markSeen(source.id, irrelevant)
      for (const item of relevant) pending.push({ source, item })
    } catch (e) {
      r.error = e instanceof Error ? e.message : String(e)
    }
  })
  return { results, pending }
}

/**
 * Phase 2 : envoie à l'IA les éléments pertinents de TOUTES les sources par gros lots
 * (un ou deux appels par passage, au lieu d'un par source), puis rattache et insère.
 * Un élément n'est marqué traité qu'une fois analysé : en cas d'échec de l'IA ou de budget
 * de temps dépassé, il est repris au passage suivant. Enregistre le passage de chaque source.
 */
export async function analyzePending(
  pending: ReadonlyArray<Pending>,
  results: SourceRunResult[],
  opts: CollectorOptions & { budgetMs?: number; startedAt?: number },
): Promise<SourceRunResult[]> {
  const startedAt = opts.startedAt ?? Date.now()
  const minCertainty = opts.minCertainty ?? 'moyenne'
  const batchSize = opts.batchSize ?? 50
  const budgetMs = opts.budgetMs ?? 110_000
  const byId = new Map(results.map((r) => [r.source_id, r]))
  const res = (s: CollectorSource) => {
    let r = byId.get(s.id)
    if (!r) {
      r = emptyResult(s)
      byId.set(s.id, r)
      results.push(r)
    }
    return r
  }

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
    const entries = new Map(batch.map((b) => [b.id, b]))
    for (const event of events) {
      const entry = entries.get(event.item_id)
      if (!entry) continue
      const r = res(entry.source)
      r.events++
      try {
        await handleEvent(event, entry.item, entry.source, r, minCertainty, opts.db)
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e)
      }
    }
    const bySource = new Map<string, string[]>()
    for (const p of group)
      bySource.set(p.source.id, [...(bySource.get(p.source.id) ?? []), p.item.externalId])
    for (const [sourceId, ids] of bySource) await opts.db.markSeen(sourceId, ids)
  }

  for (const r of results) await opts.db.recordRun(r.source_id, r.error)
  return results
}

/** Les deux phases d'un coup (une source depuis l'admin, tests). */
export async function collectSources(
  sources: ReadonlyArray<CollectorSource>,
  opts: CollectorOptions & { budgetMs?: number; fetchConcurrency?: number },
): Promise<SourceRunResult[]> {
  const startedAt = Date.now()
  const { results, pending } = await gatherSources(sources, opts)
  return analyzePending(pending, results, { ...opts, startedAt })
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
  let uai: string | null = null
  if (event.city && isGenericSchoolName(event.school_name, event.city)) {
    // « Lycée de Hanches » : rattaché seulement si la commune n'a qu'un lycée.
    const inCity = await db.schoolsInCity(event.city)
    if (inCity.length === 1) uai = inCity[0]?.uai ?? null
  } else {
    const candidates = await db.matchSchool(event.school_name, event.city)
    uai = pickMatch(candidates, Boolean(event.city))?.uai ?? null
  }
  if (!uai) {
    r.unmatched++
    await db.insertUnmatched({
      source_id: source.id,
      source_domain: item.publisherDomain ?? extractDomain(item.url),
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
    school_uai: uai,
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
