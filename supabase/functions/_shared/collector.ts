import { chunk, mapLimit } from './collector-utils.ts'
import { canonicalUrl, extractDomain } from './domain.ts'
import { enrichItems } from './enrich.ts'
import {
  isRelevant,
  meetsCertainty,
  isParisWeekend,
  resolveObservation,
  type Certainty,
  type DateBasis,
  type ExtractedEvent,
} from './extraction.ts'
import { fetchSource, type FetchLike, type ScrapedItem } from './fetchers/index.ts'
import { isBillingBlocked } from './gemini.ts'
import {
  isGenericSchoolName,
  levelOfName,
  pickByGeo,
  pickMatch,
  type NearbyCandidate,
  type SchoolCandidate,
} from './matching.ts'
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
  /** Traçabilité de la date (voir la migration report_date_trace). */
  published_at: string
  extracted_observed_at: string | null
  date_basis: DateBasis
}

export interface NewUnmatched {
  source_id: string
  /** Domaine de l'éditeur réel (utile pour Google Actualités). */
  source_domain: string | null
  context: string
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
  /** Lycées proches d'un point (cartes My Maps). */
  nearbySchools(lat: number, lng: number): Promise<NearbyCandidate[]>
  /** Établissements du même niveau dans la commune (au plus 2 suffisent pour savoir s'il n'y en a qu'un). */
  schoolsInCity(city: string, level: 'lycee' | 'superieur'): Promise<Array<{ uai: string }>>
  /** Niveau de l'établissement (null si inconnu). */
  schoolLevel(uai: string): Promise<'lycee' | 'superieur' | null>
  insertReport(report: NewReport): Promise<'inserted' | 'duplicate'>
  insertUnmatched(row: NewUnmatched): Promise<void>
  /** Fin de passage : met à jour la source et enregistre le journal (s'il y a du nouveau). */
  recordRun(result: SourceRunResult): Promise<void>
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

/** Devenir d'un nouvel élément lu pendant un passage (journal du collecteur). */
export type ItemOutcome =
  | 'hors_sujet'
  | 'aucun_fait'
  | 'certitude_faible'
  | 'rattache'
  | 'doublon'
  | 'non_rattache'
  | 'erreur'
  | 'reporte'

export interface ItemLog {
  external_id: string
  url: string
  outcome: ItemOutcome
  school_name?: string | null
  city?: string | null
  school_uai?: string | null
  status?: ReportStatus | null
  detail?: string | null
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
  /** Journal détaillé (nouveaux éléments uniquement). */
  items: ItemLog[]
}

export { chunk, mapLimit } from './collector-utils.ts'

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
    items: [],
  }
}

export interface Pending {
  source: CollectorSource
  item: ScrapedItem
}

/**
 * Un même article reçu par plusieurs sources dans un passage (flux de presse, requêtes Google
 * Actualités, comptes Bluesky…) n'est envoyé qu'une fois à l'IA, sur l'union des textes reçus : on
 * ne perd aucun fait (chaque source en apporte parfois un morceau différent) et on ne paie qu'un
 * appel. Les éléments d'une carte (position) ne sont jamais fusionnés.
 */
export function mergeSameArticle(pending: ReadonlyArray<Pending>): {
  kept: Pending[]
  /** Éléments absorbés, avec l'élément qui les représente. */
  absorbed: Array<{ item: Pending; into: Pending }>
} {
  const kept: Pending[] = []
  const absorbed: Array<{ item: Pending; into: Pending }> = []
  const byUrl = new Map<string, number>()
  for (const p of pending) {
    if (p.item.geo || p.item.alwaysRelevant) {
      kept.push(p)
      continue
    }
    const key = canonicalUrl(p.item.url)
    const at = byUrl.get(key)
    if (at === undefined) {
      byUrl.set(key, kept.length)
      kept.push(p)
      continue
    }
    const head = kept[at] as Pending
    const known = new Set(head.item.text.split('\n').map((l) => l.trim().toLowerCase()))
    const extra = p.item.text
      .split('\n')
      .filter((l) => l.trim() && !known.has(l.trim().toLowerCase()))
    if (extra.length) head.item = { ...head.item, text: `${head.item.text}\n${extra.join('\n')}` }
    absorbed.push({ item: p, into: head })
  }
  return { kept, absorbed }
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
> & {
  fetchConcurrency?: number
  /** Lecture des pages et décodage Google Actualités (désactivable dans les tests). */
  enrich?: boolean
}

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
        .slice(0, 300)
      const seen = await opts.db.seenIds(
        source.id,
        recent.map((i) => i.externalId),
      )
      const fresh = recent.filter((i) => !seen.has(i.externalId))
      r.new_items = fresh.length
      // Les pertinents (lecture de l'article, IA) sont bornés par passage, les plus récents
      // d'abord ; les suivants, non marqués comme vus, sont repris au passage suivant.
      // Une carte peut compter des centaines de points : pas de borne.
      const limit = source.kind === 'mymaps' ? 300 : (opts.maxItemsPerSource ?? 30)
      const relevant = fresh.filter((i) => i.alwaysRelevant || isRelevant(i.text)).slice(0, limit)
      r.relevant = relevant.length
      const irrelevantItems = fresh.filter((i) => !i.alwaysRelevant && !isRelevant(i.text))
      const irrelevant = irrelevantItems.map((i) => i.externalId)
      if (irrelevant.length) await opts.db.markSeen(source.id, irrelevant)
      for (const i of irrelevantItems)
        r.items.push({ external_id: i.externalId, url: i.url, outcome: 'hors_sujet' })
      // Flux RSS (dont Google Actualités) : souvent un simple titre, on lit l'article.
      const ready =
        opts.enrich === false || source.kind !== 'rss'
          ? relevant
          : await enrichItems(opts.fetchFn, relevant)
      for (const item of ready) pending.push({ source, item })
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
  opts: CollectorOptions & {
    budgetMs?: number
    startedAt?: number
    /** Après chaque lot analysé : devenir de ses éléments (mode direct). */
    onBatch?: (logs: ReadonlyArray<ItemLog>, size: number) => void
  },
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

  const merged = mergeSameArticle(pending)
  const followers = new Map<Pending, Pending[]>()
  for (const a of merged.absorbed) followers.set(a.into, [...(followers.get(a.into) ?? []), a.item])
  const groups = chunk(merged.kept, batchSize)
  for (const [groupIndex, group] of groups.entries()) {
    if (Date.now() - startedAt > budgetMs) {
      // Budget de temps dépassé : repris au prochain passage.
      for (const p of groups.slice(groupIndex).flat()) {
        res(p.source).items.push({
          external_id: p.item.externalId,
          url: p.item.url,
          outcome: 'reporte',
        })
      }
      break
    }
    const groupLogs: ItemLog[] = []
    const batch = group.map((p, idx) => ({ id: String(idx), item: p.item, source: p.source }))
    let events: ExtractedEvent[]
    try {
      events = await opts.extract(batch)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // Crédit épuisé (402) : les lots suivants échoueraient pareil. On s'arrête là, tout est
      // repris au passage suivant (rien n'est marqué traité).
      const blocked = isBillingBlocked(e)
      for (const p of group) {
        res(p.source).error = message
        res(p.source).items.push({
          external_id: p.item.externalId,
          url: p.item.url,
          outcome: 'erreur',
          detail: `IA : ${message}`.slice(0, 300),
        })
      }
      if (blocked) {
        for (const p of groups.slice(groupIndex + 1).flat()) {
          res(p.source).items.push({
            external_id: p.item.externalId,
            url: p.item.url,
            outcome: 'reporte',
          })
        }
        break
      }
      continue
    }
    const entries = new Map(batch.map((b) => [b.id, b]))
    for (const event of events) {
      const entry = entries.get(event.item_id)
      if (!entry) continue
      const r = res(entry.source)
      r.events++
      const base = {
        external_id: entry.item.externalId,
        url: entry.item.url,
        school_name: event.school_name,
        city: event.city,
        status: event.status,
      }
      let log: ItemLog
      try {
        log = {
          ...base,
          ...(await handleEvent(event, entry.item, entry.source, r, minCertainty, opts.db)),
        }
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e)
        log = { ...base, outcome: 'erreur', detail: r.error.slice(0, 300) }
      }
      r.items.push(log)
      groupLogs.push(log)
    }
    // Éléments lus par l'IA sans aucun fait de blocage.
    const withEvents = new Set(events.map((e) => e.item_id))
    for (const b of batch) {
      if (!withEvents.has(b.id)) {
        res(b.source).items.push({
          external_id: b.item.externalId,
          url: b.item.url,
          outcome: 'aucun_fait',
        })
      }
    }
    const bySource = new Map<string, string[]>()
    for (const p of group)
      bySource.set(p.source.id, [...(bySource.get(p.source.id) ?? []), p.item.externalId])
    // Éléments fusionnés avec un autre : analysés avec lui, donc marqués traités avec lui.
    for (const p of group) {
      for (const f of followers.get(p) ?? []) {
        const r = res(f.source)
        r.duplicates++
        r.items.push({
          external_id: f.item.externalId,
          url: f.item.url,
          outcome: 'doublon',
          detail: 'même article reçu par une autre source, analysé une seule fois',
        })
        bySource.set(f.source.id, [...(bySource.get(f.source.id) ?? []), f.item.externalId])
      }
    }
    for (const [sourceId, ids] of bySource) await opts.db.markSeen(sourceId, ids)
    opts.onBatch?.(groupLogs, group.length)
  }

  for (const r of results) await opts.db.recordRun(r)
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
): Promise<Pick<ItemLog, 'outcome' | 'school_uai' | 'detail'>> {
  if (!meetsCertainty(event.certainty, minCertainty)) {
    r.low_certainty++
    return { outcome: 'certitude_faible', detail: `certitude ${event.certainty}` }
  }
  const resolved = resolveObservation(event.observed_at, item.publishedAt)
  // Fait daté de plus de 7 jours avant la publication (archive, rétrospective, récit) : l'ancien
  // repli sur la date de publication le faisait passer pour un fait du jour.
  if (resolved.basis === 'stale') {
    return {
      outcome: 'aucun_fait',
      detail: 'fait ancien : date extraite > 7 jours avant la publication',
    }
  }
  const observation = { at: resolved.at, basis: resolved.basis }
  const observedAt = observation.at.toISOString()
  let uai: string | null = null
  if (item.geo) {
    // Point d'une carte : la position désigne le lycée bien mieux qu'un nom approximatif.
    const near = await db.nearbySchools(item.geo.lat, item.geo.lng)
    uai = pickByGeo(near, event.school_name)?.uai ?? null
  }
  if (uai) {
    // déjà rattaché par la position
  } else if (event.city && isGenericSchoolName(event.school_name, event.city)) {
    // « Lycée de Hanches » : rattaché seulement si la commune n'a qu'un établissement de ce niveau.
    const inCity = await db.schoolsInCity(event.city, levelOfName(event.school_name))
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
      // Extrait du texte, pour le staff et la réanalyse (supprimé avec l'extraction, 7 jours max).
      context: item.text.slice(0, 600),
      school_name: event.school_name,
      city: event.city,
      status: event.status,
      source_url: canonicalUrl(item.url),
      observed_at: observedAt,
    })
    return { outcome: 'non_rattache' }
  }
  const domain = item.publisherDomain ?? extractDomain(item.url)
  if (!domain) return { outcome: 'erreur', school_uai: uai, detail: 'lien source invalide' }
  // Un lycée est fermé le week-end : un « bloqué » daté du samedi ou du dimanche est un récit
  // ou un bilan publié ce jour-là, pas un blocage. Les facs restent exemptées (occupations).
  if (event.status === 'bloque' && isParisWeekend(observation.at)) {
    if ((await db.schoolLevel(uai)) === 'lycee') {
      return { outcome: 'aucun_fait', school_uai: uai, detail: 'lycée fermé le week-end' }
    }
  }
  const outcome = await db.insertReport({
    school_uai: uai,
    status: event.status,
    source_type: source.source_type,
    source_url: canonicalUrl(item.url),
    source_domain: domain,
    source_id: source.id,
    certainty: event.certainty,
    observed_at: observedAt,
    published_at: item.publishedAt.toISOString(),
    extracted_observed_at: event.observed_at,
    date_basis: observation.basis,
  })
  if (outcome === 'inserted') r.reports++
  else r.duplicates++
  return { outcome: outcome === 'inserted' ? 'rattache' : 'doublon', school_uai: uai }
}

/** Une seule source (bouton « collecter maintenant », tests). */
export async function collectSource(
  source: CollectorSource,
  opts: CollectorOptions,
): Promise<SourceRunResult> {
  const [result] = await collectSources([source], opts)
  return result as SourceRunResult
}
