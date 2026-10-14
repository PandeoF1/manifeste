import { schema } from '@manifeste/db'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { IngestDeps } from './deps.ts'

export interface PurgeResult {
  contents: number
  excerpts: number
  events: number
  items: number
}

/**
 * Retention. Article text is copyrighted and only needed while the item is analysed; excerpts
 * kept for the staff queue go with it; events are history, not an archive; items themselves are
 * only a ledger of what was seen, so they stay much longer than their text.
 */
export async function purgeOld(deps: IngestDeps): Promise<PurgeResult> {
  const { db, config } = deps
  const now = deps.now().getTime()
  const days = (n: number) => new Date(now - n * 86_400_000)

  const contents = await db
    .delete(schema.itemContents)
    .where(lt(schema.itemContents.fetchedAt, days(config.contentRetentionDays)))
    .returning({ id: schema.itemContents.itemId })
  const excerpts = await db
    .update(schema.unmatched)
    .set({ context: null })
    .where(
      and(
        lt(schema.unmatched.createdAt, days(config.contentRetentionDays)),
        sql`${schema.unmatched.context} is not null`,
      ),
    )
    .returning({ id: schema.unmatched.id })
  const events = await db
    .delete(schema.pipelineEvents)
    .where(lt(schema.pipelineEvents.at, days(config.eventRetentionDays)))
    .returning({ id: schema.pipelineEvents.id })
  // A year of ledger is plenty to keep re-collected items from looking new.
  const items = await db
    .delete(schema.ingestItems)
    .where(
      and(
        lt(schema.ingestItems.discoveredAt, days(365)),
        inArray(schema.ingestItems.state, ['done', 'irrelevant', 'duplicate', 'no_event']),
      ),
    )
    .returning({ id: schema.ingestItems.id })
  return {
    contents: contents.length,
    excerpts: excerpts.length,
    events: events.length,
    items: items.length,
  }
}

export interface RetryFilter {
  /** Retry these items only. */
  itemIds?: string[]
  sourceId?: string
  /** Default: failed and unreadable. */
  states?: Array<'failed' | 'unreadable'>
}

/**
 * Puts items of a lane back where they failed: a read failure re-reads, an extraction failure
 * re-asks the AI, a resolve failure re-resolves its facts. `deferred` is not retried here: it
 * comes back by itself when the AI does.
 */
export async function retryLane(deps: IngestDeps, filter: RetryFilter = {}): Promise<number> {
  const { db } = deps
  const states = filter.states ?? ['failed', 'unreadable']
  const rows = await db
    .select({
      id: schema.ingestItems.id,
      state: schema.ingestItems.state,
      reason: schema.ingestItems.reason,
      sourceId: schema.ingestItems.sourceId,
    })
    .from(schema.ingestItems)
    .where(
      and(
        inArray(schema.ingestItems.state, states),
        filter.itemIds ? inArray(schema.ingestItems.id, filter.itemIds) : undefined,
        filter.sourceId ? eq(schema.ingestItems.sourceId, filter.sourceId) : undefined,
      ),
    )
    .limit(1000)
  const backTo = (r: (typeof rows)[number]): 'discovered' | 'read' | 'extracted' =>
    r.state === 'failed' && r.reason?.startsWith('extract:')
      ? 'read'
      : r.state === 'failed' && r.reason?.startsWith('resolve:')
        ? 'extracted'
        : 'discovered'
  for (const target of ['discovered', 'read', 'extracted'] as const) {
    const ids = rows.filter((r) => backTo(r) === target).map((r) => r.id)
    if (ids.length === 0) continue
    await db
      .update(schema.ingestItems)
      .set({ state: target, reason: null, attempts: 0 })
      .where(inArray(schema.ingestItems.id, ids))
    if (target === 'extracted')
      await db
        .update(schema.extractions)
        .set({ outcome: null, outcomeDetail: null, resolvedAt: null })
        .where(
          and(inArray(schema.extractions.itemId, ids), eq(schema.extractions.outcome, 'failed')),
        )
  }
  if (rows.length > 0) {
    await deps.events.emit({ stage: 'job', outcome: 'retried', detail: { items: rows.length } })
    await deps.trigger('read')
    await deps.trigger('extract')
    await deps.trigger('resolve')
  }
  return rows.length
}
