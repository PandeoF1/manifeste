import { schema, type Database } from '@manifeste/db'
import { eq, gte, sql } from 'drizzle-orm'
import { status } from 'elysia'
import { ADAPTERS } from '../../ingest/adapters/index.ts'
import { SOURCE_PRESETS } from '../../ingest/presets.ts'
import { IdentifierError } from '../../ingest/types.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import type { JobQueue } from '../../queue/queue.ts'
import { rows } from '../../lib/sql.ts'
import type { SourcesModel } from './model.ts'

type Create = typeof SourcesModel.create.static
type Patch = typeof SourcesModel.patch.static

export class SourcesService {
  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
  ) {}

  async list() {
    const sources = await this.db.select().from(schema.sources).orderBy(schema.sources.label)
    const day = new Date(Date.now() - 24 * 3_600_000)
    const week = new Date(Date.now() - 7 * 24 * 3_600_000)
    const items = await this.db
      .select({
        sourceId: schema.ingestItems.sourceId,
        total: sql<number>`count(*)::int`,
        relevant: sql<number>`count(*) filter (where ${schema.ingestItems.state} <> 'irrelevant')::int`,
      })
      .from(schema.ingestItems)
      .where(gte(schema.ingestItems.discoveredAt, day))
      .groupBy(schema.ingestItems.sourceId)
    const reports = await this.db
      .select({ sourceId: schema.reports.sourceId, n: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(gte(schema.reports.createdAt, week))
      .groupBy(schema.reports.sourceId)
    const itemsBy = new Map(items.map((r) => [r.sourceId, r]))
    const reportsBy = new Map(reports.map((r) => [r.sourceId, r.n]))
    return sources.map((s) => ({
      id: s.id,
      kind: s.kind,
      identifier: s.identifier,
      label: s.label,
      origin: s.origin as 'press' | 'union' | 'aggregator',
      trusted: s.trusted,
      enabled: s.enabled,
      reportsHidden: s.reportsHidden,
      health: s.health,
      consecutiveFailures: s.consecutiveFailures,
      nextAttemptAt: s.nextAttemptAt,
      lastRunAt: s.lastRunAt,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      stats: {
        items24h: itemsBy.get(s.id)?.total ?? 0,
        relevant24h: itemsBy.get(s.id)?.relevant ?? 0,
        reports7d: reportsBy.get(s.id) ?? 0,
      },
    }))
  }

  /** The catalogue minus what is already added. */
  async presets() {
    const have = await this.db
      .select({ kind: schema.sources.kind, identifier: schema.sources.identifier })
      .from(schema.sources)
    const taken = new Set(have.map((s) => `${s.kind}|${s.identifier}`))
    return SOURCE_PRESETS.filter((p) => !taken.has(`${p.kind}|${p.identifier}`))
  }

  async create(input: Create, actor: Actor) {
    let identifier: string
    try {
      identifier = ADAPTERS[input.kind].normalize(input.identifier)
    } catch (e) {
      if (e instanceof IdentifierError) return status(422, e.message)
      throw e
    }
    const [row] = await this.db
      .insert(schema.sources)
      .values({
        kind: input.kind,
        identifier,
        label: input.label.trim(),
        origin: input.origin,
        trusted: input.trusted,
      })
      .onConflictDoNothing()
      .returning({ id: schema.sources.id })
    if (!row) return status(409, 'This source is already added')
    await audit(this.db, actor, 'source.create', row.id, null, { ...input, identifier })
    // Read it right away: the admin wants to see it work.
    await this.queue.send(
      'ingest.discover',
      { sourceId: row.id, trigger: 'manual' },
      { singletonKey: row.id },
    )
    return (
      (await this.list()).find((s) => s.id === row.id) ??
      status(500, 'Source not found after creation')
    )
  }

  async update(id: string, patch: Patch, actor: Actor) {
    const [before] = await this.db.select().from(schema.sources).where(eq(schema.sources.id, id))
    if (!before) return status(404, 'Unknown source')
    await this.db.update(schema.sources).set(patch).where(eq(schema.sources.id, id))
    await audit(this.db, actor, 'source.update', id, pick(before, patch), patch)
    return (await this.list()).find((s) => s.id === id) ?? status(404, 'Unknown source')
  }

  async remove(id: string, actor: Actor) {
    const [before] = await this.db.select().from(schema.sources).where(eq(schema.sources.id, id))
    if (!before) return status(404, 'Unknown source')
    await this.db.delete(schema.sources).where(eq(schema.sources.id, id))
    await audit(this.db, actor, 'source.delete', id, {
      kind: before.kind,
      identifier: before.identifier,
      label: before.label,
    })
    return new Response(null, { status: 204 })
  }

  /** Queues a read now, whatever the breaker says. */
  async run(id: string, actor: Actor) {
    const [source] = await this.db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(eq(schema.sources.id, id))
    if (!source) return status(404, 'Unknown source')
    // No job id back means a read of this source is already waiting: it will do.
    await this.queue.send(
      'ingest.discover',
      { sourceId: id, trigger: 'manual' },
      { singletonKey: id },
    )
    await audit(this.db, actor, 'source.run', id)
    return { queued: true }
  }

  /** Closes the breaker: the next scheduled read tries again at once. */
  async resetHealth(id: string, actor: Actor) {
    const done = await this.db
      .update(schema.sources)
      .set({ health: 'closed', consecutiveFailures: 0, nextAttemptAt: null })
      .where(eq(schema.sources.id, id))
      .returning({ id: schema.sources.id })
    if (done.length === 0) return status(404, 'Unknown source')
    await audit(this.db, actor, 'source.reset-health', id)
    return (await this.list()).find((s) => s.id === id) ?? status(404, 'Unknown source')
  }

  /** Last runs of a source, newest first. */
  runs(sourceId: string, limit = 20) {
    return rows<{
      startedAt: Date
      finishedAt: Date | null
      trigger: string
      fetched: number
      newItems: number
      error: string | null
    }>(
      this.db,
      sql`select started_at as "startedAt", finished_at as "finishedAt", trigger, fetched, new_items as "newItems", error
          from source_runs where source_id = ${sourceId} order by started_at desc limit ${Math.min(limit, 100)}`,
    )
  }
}

const pick = (from: Record<string, unknown>, keys: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(keys).map((k) => [k, from[k]]))
