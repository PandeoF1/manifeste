import { schema, type Database } from '@manifeste/db'
import { and, desc, eq, gt, gte, sql } from 'drizzle-orm'
import { status } from 'elysia'
import { IngestOperations, type Operation } from '../../ingest/operations.ts'
import type { IngestService } from '../../ingest/service.ts'
import { audit, type Actor } from '../../lib/audit.ts'
import { rows } from '../../lib/sql.ts'
import type { JobQueue } from '../../queue/queue.ts'
import { KNOWN_STAGES, type PipelineModel } from './model.ts'

type EventsQuery = typeof PipelineModel.eventsQuery.static
type ItemsQuery = typeof PipelineModel.itemsQuery.static
type Retry = typeof PipelineModel.retry.static
type OperationBody = typeof PipelineModel.operation.static

/** Upper edges of the latency histogram, in milliseconds: 11 bars with the overflow. */
export const LATENCY_EDGES_MS = [10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000]

export class PipelineService {
  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly ingest: IngestService,
  ) {}

  async overview() {
    const day = new Date(Date.now() - 24 * 3_600_000)
    const week = new Date(Date.now() - 7 * 24 * 3_600_000)
    const stateRows = await this.db
      .select({ state: schema.ingestItems.state, n: sql<number>`count(*)::int` })
      .from(schema.ingestItems)
      .where(gte(schema.ingestItems.discoveredAt, week))
      .groupBy(schema.ingestItems.state)
    const eventRows = await this.db
      .select({
        stage: schema.pipelineEvents.stage,
        outcome: schema.pipelineEvents.outcome,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.pipelineEvents)
      .where(gte(schema.pipelineEvents.at, day))
      .groupBy(schema.pipelineEvents.stage, schema.pipelineEvents.outcome)
    const [funnel] = await rows<{
      discovered: number
      relevant: number
      read: number
      extracted: number
      facts: number
      reported: number
      unmatched: number
    }>(
      this.db,
      sql`select
            (select count(*) from ingest_items where discovered_at >= ${day})::int as discovered,
            (select count(*) from ingest_items where discovered_at >= ${day} and state <> 'irrelevant')::int as relevant,
            (select count(*) from ingest_items where discovered_at >= ${day} and state in ('read', 'extracted', 'done', 'no_event'))::int as read,
            (select count(*) from ingest_items where discovered_at >= ${day} and state in ('extracted', 'done'))::int as extracted,
            (select count(*) from extractions where created_at >= ${day})::int as facts,
            (select count(*) from extractions where created_at >= ${day} and outcome = 'reported')::int as reported,
            (select count(*) from extractions where created_at >= ${day} and outcome = 'unmatched')::int as unmatched`,
    )
    const sourceRows = await this.db
      .select({
        health: schema.sources.health,
        enabled: schema.sources.enabled,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.sources)
      .groupBy(schema.sources.health, schema.sources.enabled)
    const stages: Record<string, Record<string, number>> = {}
    for (const r of eventRows) (stages[r.stage] ??= {})[r.outcome] = r.n
    const sources: Record<string, number> = {}
    for (const r of sourceRows)
      sources[r.enabled ? r.health : 'disabled'] =
        (sources[r.enabled ? r.health : 'disabled'] ?? 0) + r.n
    const queues = (await this.queue.stats())
      .filter((q) => q.name.startsWith('ingest.'))
      .map((q) => ({
        name: q.name,
        queued: q.queued,
        active: q.active,
        deferred: q.deferred,
        failed: q.failed,
      }))
    return {
      states: Object.fromEntries(stateRows.map((r) => [r.state, r.n])),
      stages,
      funnel: funnel ?? {
        discovered: 0,
        relevant: 0,
        read: 0,
        extracted: 0,
        facts: 0,
        reported: 0,
        unmatched: 0,
      },
      sources,
      queues,
      stagesKnown: KNOWN_STAGES,
    }
  }

  events(q: EventsQuery) {
    return this.db
      .select()
      .from(schema.pipelineEvents)
      .where(
        and(
          q.stage ? eq(schema.pipelineEvents.stage, q.stage) : undefined,
          q.sourceId ? eq(schema.pipelineEvents.sourceId, q.sourceId) : undefined,
          q.after !== undefined ? gt(schema.pipelineEvents.id, q.after) : undefined,
        ),
      )
      .orderBy(desc(schema.pipelineEvents.id))
      .limit(q.limit ?? 100)
  }

  items(q: ItemsQuery) {
    return this.db
      .select({
        id: schema.ingestItems.id,
        sourceId: schema.ingestItems.sourceId,
        source: schema.sources.label,
        url: schema.ingestItems.url,
        state: schema.ingestItems.state,
        reason: schema.ingestItems.reason,
        attempts: schema.ingestItems.attempts,
        publishedAt: schema.ingestItems.publishedAt,
        discoveredAt: schema.ingestItems.discoveredAt,
        updatedAt: schema.ingestItems.updatedAt,
      })
      .from(schema.ingestItems)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.ingestItems.sourceId))
      .where(
        and(
          q.state ? eq(schema.ingestItems.state, q.state) : undefined,
          q.sourceId ? eq(schema.ingestItems.sourceId, q.sourceId) : undefined,
        ),
      )
      .orderBy(desc(schema.ingestItems.updatedAt))
      .limit(q.limit ?? 50)
  }

  /** Events per hour and stage, for the throughput chart. */
  async throughput(hours: number) {
    const found = await rows<{ hour: Date; stage: string; outcome: string; n: number }>(
      this.db,
      sql`select date_trunc('hour', at) as hour, stage, outcome, count(*)::int as n
          from pipeline_events where at >= now() - make_interval(hours => ${hours})
          group by 1, 2, 3 order by 1`,
    )
    return found.map((r) => ({ ...r, hour: new Date(r.hour) }))
  }

  /** Step duration per stage: percentiles and a log-scale histogram (edges in `LATENCY_EDGES_MS`). */
  async latency(hours: number) {
    const found = await rows<{ stage: string; n: number; p50: number; p95: number; max: number }>(
      this.db,
      sql`select stage, count(*)::int as n,
                 percentile_cont(0.5) within group (order by duration_ms)::int as p50,
                 percentile_cont(0.95) within group (order by duration_ms)::int as p95,
                 max(duration_ms)::int as max
          from pipeline_events
          where at >= now() - make_interval(hours => ${hours}) and duration_ms is not null
          group by stage order by stage`,
    )
    const edges = sql.raw(`array[${LATENCY_EDGES_MS.join(',')}]`)
    const buckets = await rows<{ stage: string; bucket: number; n: number }>(
      this.db,
      sql`select stage, width_bucket(duration_ms, ${edges}) as bucket, count(*)::int as n
          from pipeline_events
          where at >= now() - make_interval(hours => ${hours}) and duration_ms is not null
          group by 1, 2`,
    )
    return found.map((r) => ({
      ...r,
      histogram: Array.from({ length: LATENCY_EDGES_MS.length + 1 }, (_, i) =>
        buckets.filter((b) => b.stage === r.stage && b.bucket === i).reduce((n, b) => n + b.n, 0),
      ),
    }))
  }

  async retry(input: Retry, actor: Actor) {
    const count = await this.ingest.retry({
      ...(input.itemIds && { itemIds: input.itemIds }),
      ...(input.sourceId && { sourceId: input.sourceId }),
      ...(input.states && { states: input.states }),
    })
    await audit(this.db, actor, 'pipeline.retry', null, null, { ...input, count })
    return { retried: count }
  }

  /**
   * Starts an operation on collected data. A dry run (the default) is answered at once and costs
   * nothing; a real one is queued and its outcome shows in the pipeline events.
   */
  async operation(body: OperationBody, actor: Actor) {
    const op = this.toOperation(body)
    if (typeof op === 'string') return status(422, op)
    const dryRun = body.dryRun ?? true
    await audit(this.db, actor, `pipeline.${op.kind}`, null, null, { ...body, dryRun })
    if (dryRun) return new IngestOperations(this.ingest).run(op, { dryRun: true })
    await this.queue.send('ingest.operation', op)
    return { queued: true }
  }

  private toOperation(b: OperationBody): Operation | string {
    switch (b.kind) {
      case 'backfill':
      case 'reextract':
        if (!b.sinceHours) return `${b.kind} needs sinceHours`
        return {
          kind: b.kind,
          sinceHours: b.sinceHours,
          ...(b.sourceId && { sourceId: b.sourceId }),
        }
      case 'rejudge':
        if (!b.sinceHours) return 'rejudge needs sinceHours'
        return { kind: 'rejudge', sinceHours: b.sinceHours, ...(b.limit && { limit: b.limit }) }
      case 'rematch':
        return {
          kind: 'rematch',
          ...(b.limit && { limit: b.limit }),
          ...(b.useAi && { useAi: true }),
        }
    }
  }

  /** Reads every due source now and nudges every stage (what the tick does, on demand). */
  async runNow(actor: Actor) {
    await this.queue.send('ingest.tick', {}, { singletonKey: 'tick' })
    await audit(this.db, actor, 'pipeline.run-now', null)
    return { queued: true }
  }
}
