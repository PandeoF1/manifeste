// Logique pure du rattrapage historique (voir scripts/backfill.ts), testée dans tests/backfill.test.ts.
import type { SourceRunResult } from '../supabase/functions/_shared/collector.ts'
import type { ScrapedItem } from '../supabase/functions/_shared/fetchers/types.ts'
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
  return /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(message)
}
