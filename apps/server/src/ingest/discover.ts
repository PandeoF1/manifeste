/**
 * The "discover" stage: read one source, keep what is recent, remember what is new. Also the
 * first relevance filter, on the cheapest text there is (what the source itself says), so no page
 * is fetched and no AI call is spent on an off-topic item. The source's circuit breaker lives here.
 */
import {
  afterAttempt,
  beforeAttempt,
  canonicalUrl,
  isRelevant,
  mayAttempt,
  type SourceState,
} from '@manifeste/core'
import { schema } from '@manifeste/db'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { ADAPTERS } from './adapters/index.ts'
import { errorMessage, type IngestDeps } from './deps.ts'
import { inSpan } from './events.ts'
import { chunk } from './http.ts'
import { isGoogleNewsUrl } from './googlenews.ts'

export interface DiscoverResult {
  runId: string
  fetched: number
  newItems: number
  relevant: number
  /** Why nothing was read. */
  skipped?: 'unknown' | 'disabled' | 'breaker-open'
  error?: string
}

/** Most recent items kept per read, whatever the feed holds. */
const MAX_PER_READ = 300

export async function discoverSource(
  deps: IngestDeps,
  sourceId: string,
  trigger: 'schedule' | 'manual' = 'schedule',
): Promise<DiscoverResult> {
  const { db, config, events } = deps
  const now = deps.now()
  const runId = randomUUID()
  const empty: DiscoverResult = { runId, fetched: 0, newItems: 0, relevant: 0 }

  const [source] = await db.select().from(schema.sources).where(eq(schema.sources.id, sourceId))
  if (!source) return { ...empty, skipped: 'unknown' }
  if (!source.enabled && trigger === 'schedule') return { ...empty, skipped: 'disabled' }

  const state: SourceState = {
    health: source.health,
    consecutiveFailures: source.consecutiveFailures,
    nextAttemptAt: source.nextAttemptAt,
  }
  // A manual run is an explicit decision: it goes through whatever the breaker says.
  if (trigger === 'schedule' && !mayAttempt(state, now)) {
    await events.emit({
      stage: 'discover',
      outcome: 'skipped',
      runId,
      sourceId,
      detail: { reason: 'breaker open', until: source.nextAttemptAt?.toISOString() ?? null },
    })
    return { ...empty, skipped: 'breaker-open' }
  }
  const trial = beforeAttempt(state, now)
  if (trial.health !== state.health)
    await db
      .update(schema.sources)
      .set({ health: trial.health })
      .where(eq(schema.sources.id, sourceId))

  const [run] = await db
    .insert(schema.sourceRuns)
    .values({ sourceId, trigger, startedAt: now })
    .returning({ id: schema.sourceRuns.id })
  const started = performance.now()

  try {
    return await inSpan(
      'ingest.discover',
      { source: source.label, kind: source.kind },
      async () => {
        const fetched = await ADAPTERS[source.kind].discover(deps.fetchFn, source.identifier, now)
        const cutoff = now.getTime() - config.lookbackHours * 3_600_000
        const recent = fetched
          .filter((i) => i.publishedAt.getTime() >= cutoff)
          .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
          .slice(0, MAX_PER_READ)

        let newItems = 0
        let relevant = 0
        for (const group of chunk(recent, 100)) {
          const inserted = await db
            .insert(schema.ingestItems)
            .values(
              group.map((i) => {
                const keep = Boolean(i.alwaysRelevant) || isRelevant(i.text)
                return {
                  sourceId,
                  externalId: i.externalId,
                  url: isGoogleNewsUrl(i.url) ? i.url : canonicalUrl(i.url),
                  publishedAt: i.publishedAt,
                  publisherDomain: i.publisherDomain ?? null,
                  geoLat: i.geo?.lat ?? null,
                  geoLng: i.geo?.lng ?? null,
                  alwaysRelevant: Boolean(i.alwaysRelevant),
                  state: keep ? ('discovered' as const) : ('irrelevant' as const),
                  reason: keep ? null : 'off topic',
                  runId,
                  // What the source said, kept with the item until the read stage replaces it.
                  // (Held in item_contents so a text never sits on the item row.)
                }
              }),
            )
            .onConflictDoNothing()
            .returning({
              id: schema.ingestItems.id,
              externalId: schema.ingestItems.externalId,
              state: schema.ingestItems.state,
            })
          newItems += inserted.length
          relevant += inserted.filter((r) => r.state === 'discovered').length
          const byExternal = new Map(group.map((i) => [i.externalId, i]))
          const contents = inserted
            .filter((r) => r.state === 'discovered')
            .flatMap((r) => {
              const item = byExternal.get(r.externalId)
              return item
                ? [
                    {
                      itemId: r.id,
                      text: item.text,
                      chars: item.text.length,
                      strategy: 'feed',
                      title: item.text.split('\n')[0] ?? '',
                    },
                  ]
                : []
            })
          if (contents.length > 0)
            await db.insert(schema.itemContents).values(contents).onConflictDoNothing()
        }

        const next = afterAttempt(trial, true, now)
        await db
          .update(schema.sources)
          .set({
            health: next.health,
            consecutiveFailures: 0,
            nextAttemptAt: null,
            lastRunAt: now,
            lastSuccessAt: now,
            lastError: null,
          })
          .where(eq(schema.sources.id, sourceId))
        if (run)
          await db
            .update(schema.sourceRuns)
            .set({ finishedAt: deps.now(), fetched: fetched.length, newItems })
            .where(eq(schema.sourceRuns.id, run.id))

        const durationMs = performance.now() - started
        await events.emit(
          {
            stage: 'discover',
            outcome: 'ok',
            runId,
            sourceId,
            durationMs,
            detail: { fetched: fetched.length, recent: recent.length, new: newItems },
          },
          ...(newItems - relevant > 0
            ? [
                {
                  stage: 'relevance' as const,
                  outcome: 'irrelevant',
                  runId,
                  sourceId,
                  detail: { count: newItems - relevant },
                },
              ]
            : []),
        )
        if (relevant > 0) await deps.trigger('read')
        return { runId, fetched: fetched.length, newItems, relevant }
      },
    )
  } catch (e) {
    const message = errorMessage(e)
    const next = afterAttempt(trial, false, now)
    await db
      .update(schema.sources)
      .set({
        health: next.health,
        consecutiveFailures: next.consecutiveFailures,
        nextAttemptAt: next.nextAttemptAt,
        lastRunAt: now,
        lastError: message.slice(0, 500),
      })
      .where(eq(schema.sources.id, sourceId))
    if (run)
      await db
        .update(schema.sourceRuns)
        .set({ finishedAt: deps.now(), error: message.slice(0, 500) })
        .where(eq(schema.sourceRuns.id, run.id))
    await events.emit({
      stage: 'discover',
      outcome: 'failed',
      runId,
      sourceId,
      durationMs: performance.now() - started,
      detail: {
        error: message.slice(0, 300),
        health: next.health,
        failures: next.consecutiveFailures,
      },
    })
    return { ...empty, error: message }
  }
}
