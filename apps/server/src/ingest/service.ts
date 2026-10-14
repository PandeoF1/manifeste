import { schema } from '@manifeste/db'
import { and, eq, lte, or, isNull } from 'drizzle-orm'
import type { Ai } from '@manifeste/ai'
import type { AppContext } from '../context.ts'
import { MatchingService } from '../modules/schools/matching.ts'
import { SettingsService } from '../modules/settings/service.ts'
import { DEFAULT_INGEST_CONFIG, type IngestConfig } from './config.ts'
import type { IngestDeps, SweepStage } from './deps.ts'
import { discoverSource, type DiscoverResult } from './discover.ts'
import { PipelineEvents } from './events.ts'
import { extractSweep } from './extract-stage.ts'
import { purgeOld, retryLane, type RetryFilter } from './housekeeping.ts'
import { mediaSweep } from './media-stage.ts'
import { readSweep } from './read-stage.ts'
import { ReportStore } from './report-store.ts'
import { safeFetch } from './safe-fetch.ts'
import { resolveSweep } from './resolve-stage.ts'
import type { FetchLike } from './types.ts'

export interface IngestOverrides {
  config?: Partial<IngestConfig>
  /** Other models than the context's (tests). */
  ai?: Ai
  fetchFn?: FetchLike
  now?: () => Date
  /** Replaces the queue wake-ups (tests drive the stages by hand). */
  trigger?: (stage: SweepStage) => Promise<void>
}

/**
 * The ingestion pipeline as one object: the stages, wired to the application context. The worker
 * registers it on the queue (`jobs.ts`); the admin API and the tests call it directly.
 */
export class IngestService {
  readonly deps: IngestDeps

  constructor(ctx: AppContext, overrides: IngestOverrides = {}) {
    const config = { ...DEFAULT_INGEST_CONFIG, ...ctx.ingestConfig, ...overrides.config }
    const settings = new SettingsService(ctx.db)
    this.deps = {
      db: ctx.db,
      config,
      events: new PipelineEvents(ctx.db, ctx.bus, ctx.log.child({ component: 'pipeline' })),
      ai: overrides.ai ?? ctx.ai,
      aiUsage: ctx.aiUsage,
      matching: new MatchingService(ctx.db),
      settings,
      reports: new ReportStore(ctx.db, settings, ctx.bus),
      fetchFn: overrides.fetchFn ?? safeFetch((url, init) => fetch(url, init)),
      log: ctx.log.child({ component: 'ingest' }),
      now: overrides.now ?? (() => new Date()),
      trigger:
        overrides.trigger ??
        (async (stage) => {
          await ctx.queue.send(`ingest.${stage}`, {}, { singletonKey: stage, startAfterSeconds: 2 })
        }),
    }
  }

  discover(sourceId: string, trigger: 'schedule' | 'manual' = 'schedule'): Promise<DiscoverResult> {
    return discoverSource(this.deps, sourceId, trigger)
  }
  read = () => readSweep(this.deps)
  extract = () => extractSweep(this.deps)
  resolve = () => resolveSweep(this.deps)
  media = () => mediaSweep(this.deps)
  purge = () => purgeOld(this.deps)
  retry = (filter?: RetryFilter) => retryLane(this.deps, filter)

  /** Sources worth reading now: enabled, and not paused by their circuit breaker. */
  async dueSources(): Promise<string[]> {
    const now = this.deps.now()
    const rows = await this.deps.db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.enabled, true),
          or(isNull(schema.sources.nextAttemptAt), lte(schema.sources.nextAttemptAt, now)),
        ),
      )
    return rows.map((r) => r.id)
  }

  /**
   * Runs the sweeps, one after the other, until nothing is waiting. For tests, the admin's "run
   * now" and the command line; the worker lets the queue do the same thing asynchronously.
   */
  async drain(maxRounds = 10): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      const r = await this.read()
      const e = await this.extract()
      const s = await this.resolve()
      if (
        !r.more &&
        !e.more &&
        !s.more &&
        r.read + r.merged + e.extracted + e.noEvent + s.facts === 0
      )
        return
    }
  }
}
