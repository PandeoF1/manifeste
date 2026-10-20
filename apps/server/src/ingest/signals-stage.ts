/**
 * The signals stage: street demonstrations of any cause, reported by the press, placed on the map.
 * Each one becomes a movement event of kind `signaled` ("Mobilisation signalée"), attached to an
 * active movement when the article names its cause (the model picks among the active ones, with a
 * quote), else following none: a point when the article names a street or a place, a red zone when it names a district,
 * a neighbourhood or only the commune. A precise place that cannot be found falls back to the
 * commune, never to a guess. Off until the admin switch `signaled_mobilisations` is on.
 *
 * One AI call per article, ever (signal_scans); the same demonstration told by several outlets is
 * one event (dedupe_key).
 */
import { AiError, detectSignals, type DetectedSignal } from '@manifeste/ai'
import { extractDomain, isDemonstration, type Zone } from '@manifeste/core'
import { schema } from '@manifeste/db'
import { and, desc, eq, gte, inArray, isNull, notExists, sql } from 'drizzle-orm'
import type { IngestDeps } from './deps.ts'
import { inSpan } from './events.ts'
import { chunk } from './http.ts'
import { fold, Geocoder } from './geocode.ts'
import { parisDay, plausibleDay } from './routes-stage.ts'

export interface SignalsSweepResult {
  scanned: number
  skipped: number
  calls: number
  events: number
  more: boolean
}

const MIN_TEXT = 250
const MAX_MOVEMENTS = 12

/** Noon in Paris on a day (summer or winter time), as an instant. */
export function parisNoon(day: string): Date {
  const guess = new Date(`${day}T12:00:00Z`)
  const part = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Paris',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(guess)
    .find((p) => p.type === 'timeZoneName')?.value
  const hours = Number(/GMT([+-]\d+)/.exec(part ?? '')?.[1] ?? 1)
  return new Date(guess.getTime() - hours * 3_600_000)
}

const centroid = (zone: Zone): [number, number] => {
  const ring = (zone.coordinates[0] ?? []).slice(0, -1)
  const n = Math.max(1, ring.length)
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
}

export interface PlacedSignal {
  precision: 'point' | 'district' | 'city'
  lng: number
  lat: number
  zone: Zone | null
  place: string
  label: string | null
}

/** Where a detected mobilisation goes on the map: a point, a district zone, or the commune. */
export async function placeSignal(
  geocoder: Geocoder,
  signal: DetectedSignal,
  commune: Awaited<ReturnType<Geocoder['commune']>> & object,
): Promise<PlacedSignal | null> {
  const { level, name } = signal.place
  if (level === 'street' || level === 'place') {
    const fix = await geocoder.place(name, commune)
    if (fix.status === 'ok' && fix.lng != null && fix.lat != null)
      return {
        precision: 'point',
        lng: fix.lng,
        lat: fix.lat,
        zone: null,
        place: `${name}, ${commune.name}`,
        label: fix.label,
      }
  } else if (level === 'district' || level === 'neighbourhood') {
    const area = await geocoder.zone(level, name, commune)
    if (area) {
      const [lng, lat] = centroid(area.zone)
      return {
        precision: 'district',
        lng,
        lat,
        zone: area.zone,
        place: `${name}, ${commune.name}`,
        label: area.label,
      }
    }
  }
  // Nothing more precise could be found: the whole commune, in red.
  const city = await geocoder.zone('city', commune.name, commune)
  if (!city) return null
  return {
    precision: 'city',
    lng: commune.lng,
    lat: commune.lat,
    zone: city.zone,
    place: commune.name,
    label: city.label,
  }
}

export async function signalsSweep(deps: IngestDeps): Promise<SignalsSweepResult> {
  const { db, config, ai } = deps
  const result: SignalsSweepResult = { scanned: 0, skipped: 0, calls: 0, events: 0, more: false }
  if (!config.signalsEnabled || !ai.config.enabled) return result
  if (!(await deps.settings.all()).signaled_mobilisations) return result

  const since = new Date(deps.now().getTime() - config.contentRetentionDays * 86_400_000)
  const limit = config.signalsBatchSize * config.maxSignalsCalls
  const rows = await db
    .select({
      id: schema.ingestItems.id,
      scope: schema.ingestItems.scope,
      url: schema.ingestItems.url,
      publishedAt: schema.ingestItems.publishedAt,
      publisherDomain: schema.ingestItems.publisherDomain,
      text: schema.itemContents.text,
      title: schema.itemContents.title,
    })
    .from(schema.ingestItems)
    .innerJoin(schema.itemContents, eq(schema.itemContents.itemId, schema.ingestItems.id))
    .where(
      and(
        inArray(schema.ingestItems.state, ['read', 'extracted', 'done', 'no_event']),
        gte(schema.ingestItems.discoveredAt, since),
        sql`${schema.ingestItems.url} not like 'https://news.google.com/%'`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.signalScans)
            .where(eq(schema.signalScans.url, schema.ingestItems.url)),
        ),
      ),
    )
    .orderBy(desc(schema.ingestItems.publishedAt))
    .limit(limit * 4 + 1)

  const seen = new Set<string>()
  const unique = rows.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
  const worth = unique.filter((r) => r.text.length >= MIN_TEXT && isDemonstration(r.text))
  const skip = unique.filter((r) => !(r.text.length >= MIN_TEXT && isDemonstration(r.text)))
  if (skip.length > 0) {
    await db
      .insert(schema.signalScans)
      .values(skip.map((r) => ({ url: r.url, found: 0 })))
      .onConflictDoNothing()
    result.skipped = skip.length
    // A demonstration-only item has nothing else to wait for: out of the funnel.
    const demoIds = skip.filter((r) => r.scope === 'demonstration').map((r) => r.id)
    if (demoIds.length > 0)
      await db
        .update(schema.ingestItems)
        .set({ state: 'done', reason: 'signals: not a demonstration' })
        .where(inArray(schema.ingestItems.id, demoIds))
  }
  const todo = worth.slice(0, limit)
  result.more = worth.length > limit
  if (todo.length === 0) return { ...result, more: false }

  // Active movements the model may attach a mobilisation to (a handful, so the prompt stays small).
  const active = await db
    .select({
      id: schema.movements.id,
      name: schema.movements.name,
      description: schema.movements.description,
    })
    .from(schema.movements)
    .where(eq(schema.movements.status, 'active'))
    .orderBy(desc(schema.movements.startsAt))
    .limit(MAX_MOVEMENTS)
  const offered = active.map((m, i) => ({ key: `m${i + 1}`, ...m }))
  const movementOf = new Map(offered.map((m) => [m.key, m.id]))

  const chain = ai.signalsChain()
  const geocoder = new Geocoder(deps.fetchFn)
  for (const group of chunk(todo, config.signalsBatchSize)) {
    let signals: DetectedSignal[]
    try {
      signals = await inSpan('ingest.signals', { items: group.length }, () =>
        detectSignals(
          chain,
          group.map((g, i) => ({
            id: String(i),
            text: g.text,
            publishedOn: parisDay(g.publishedAt),
          })),
          offered,
        ),
      )
      result.calls++
    } catch (e) {
      deps.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'signals detection failed')
      if (e instanceof AiError && ['billing', 'budget', 'disabled', 'auth'].includes(e.kind)) break
      continue
    }
    const found = new Map<string, number>()
    for (const s of signals) {
      const article = group[Number(s.itemId)]
      if (!article) continue
      const domain = article.publisherDomain ?? extractDomain(article.url)
      const commune = await geocoder.commune(s.city)
      if (!commune) continue
      let day = s.day && plausibleDay(s.day, article.publishedAt) ? s.day : null
      day ??= s.timing === 'announced' ? null : parisDay(article.publishedAt)
      if (!day) continue
      const placed = await placeSignal(geocoder, s, commune)
      if (!placed) continue
      const startsAt =
        s.timing === 'ongoing' && day === parisDay(article.publishedAt)
          ? article.publishedAt
          : parisNoon(day)
      const key = `${commune.code}|${day}|${placed.precision === 'city' ? 'city' : fold(s.place.name)}`
      const movementId = (s.movement && movementOf.get(s.movement)) || null
      const inserted = await db
        .insert(schema.movementEvents)
        .values({
          movementId,
          kind: 'signaled',
          title: s.title || `Mobilisation à ${commune.name}`,
          place: placed.place,
          startsAt,
          lat: placed.lat,
          lng: placed.lng,
          zone: placed.zone,
          precision: placed.precision,
          citycode: commune.code,
          dedupeKey: key,
          sourceUrl: article.url.startsWith('https://') ? article.url : null,
          sourceDomain: domain,
          moderation: 'approved',
        })
        .onConflictDoNothing()
        .returning({ id: schema.movementEvents.id })
      // The same demonstration read earlier without a movement: attach it now (never move one that
      // is already attached, a person may have decided).
      if (inserted.length === 0 && movementId)
        await db
          .update(schema.movementEvents)
          .set({ movementId })
          .where(
            and(eq(schema.movementEvents.dedupeKey, key), isNull(schema.movementEvents.movementId)),
          )
      if (inserted.length > 0) {
        result.events++
        found.set(article.url, (found.get(article.url) ?? 0) + 1)
      }
    }
    await db
      .insert(schema.signalScans)
      .values(group.map((g) => ({ url: g.url, found: found.get(g.url) ?? 0 })))
      .onConflictDoNothing()
    const demoIds = group.filter((g) => g.scope === 'demonstration').map((g) => g.id)
    if (demoIds.length > 0)
      await db
        .update(schema.ingestItems)
        .set({ state: 'done', reason: 'signals: analysed' })
        .where(inArray(schema.ingestItems.id, demoIds))
    result.scanned += group.length
  }
  await deps.events.emit({ stage: 'signals', outcome: 'ok', detail: { ...result } })
  await deps.aiUsage.flush()
  if (result.more && result.scanned > 0) await deps.trigger('signals')
  return result
}
