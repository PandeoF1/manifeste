/**
 * The "store" stage: a collected fact becomes a report, and moderation is decided by the rules of
 * `@manifeste/core` (trusted source, trusted domain, two independent sources agreeing, else the
 * moderation queue). One transaction per report, serialised per school so two sources reporting
 * the same blockade at the same moment cannot miss each other.
 */
import {
  decideModeration,
  isTrustedDomain,
  tierOf,
  type Certainty,
  type DateBasis,
  type ReportForValidation,
  type ReportStatus,
} from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import type { JudgeVerdict } from '@manifeste/ai'
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import type { SettingsService } from '../modules/settings/service.ts'
import type { EventBus } from '../realtime/bus.ts'

export interface NewCollectedReport {
  schoolUai: string
  status: ReportStatus
  sourceId: string
  sourceUrl: string
  sourceDomain: string
  certainty: Certainty
  observedAt: Date
  publishedAt: Date
  extractedObservedAt: string | null
  dateBasis: DateBasis
  verdict: JudgeVerdict | null
  /** The directory's level for the school, to spot a judge that places it elsewhere. */
  schoolLevel: 'secondary' | 'higher' | null
}

export type StoreOutcome =
  | { outcome: 'inserted'; reportId: string; moderation: 'approved' | 'pending'; reason: string }
  | { outcome: 'duplicate' }
  | { outcome: 'no_source' }

export class ReportStore {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly bus: EventBus | null,
  ) {}

  async insert(input: NewCollectedReport): Promise<StoreOutcome> {
    const [source] = await this.db
      .select()
      .from(schema.sources)
      .where(eq(schema.sources.id, input.sourceId))
    if (!source) return { outcome: 'no_source' }
    const settings = await this.settings.all()
    const trustedDomains = (await this.db.select().from(schema.trustedDomains)).map((d) => d.domain)
    const { verdict } = input
    const levelConflict =
      verdict?.level != null &&
      verdict.level !== 'unknown' &&
      input.schoolLevel != null &&
      verdict.level !== input.schoolLevel
    const tier = tierOf(
      {
        probability: verdict?.probability ?? null,
        nature: verdict?.nature ?? null,
        status: input.status,
        levelConflict,
      },
      { keep: settings.judge_keep, low: settings.judge_low },
    )
    const windowMs = settings.concordance_window_hours * 3_600_000

    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`report:${input.schoolUai}`}))`)
      const neighbours = await tx
        .select({
          id: schema.reports.id,
          schoolUai: schema.reports.schoolUai,
          status: schema.reports.status,
          origin: schema.reports.origin,
          observedAt: schema.reports.observedAt,
          sourceId: schema.reports.sourceId,
          sourceDomain: schema.reports.sourceDomain,
          moderation: schema.reports.moderation,
        })
        .from(schema.reports)
        .where(
          and(
            eq(schema.reports.schoolUai, input.schoolUai),
            eq(schema.reports.status, input.status),
            ne(schema.reports.moderation, 'rejected'),
            ne(schema.reports.origin, 'on_site'),
            gte(schema.reports.observedAt, new Date(input.observedAt.getTime() - windowMs)),
            lte(schema.reports.observedAt, new Date(input.observedAt.getTime() + windowMs)),
          ),
        )
      const candidate: ReportForValidation = {
        schoolUai: input.schoolUai,
        status: input.status,
        origin: source.origin,
        observedAt: input.observedAt,
        sourceId: source.id,
        sourceDomain: input.sourceDomain,
        moderation: 'pending',
      }
      const decision = decideModeration(candidate, {
        sourceTrusted: source.trusted,
        domainTrusted: isTrustedDomain(input.sourceDomain, trustedDomains),
        neighbours: neighbours as ReportForValidation[],
        windowHours: settings.concordance_window_hours,
      })
      const [row] = await tx
        .insert(schema.reports)
        .values({
          schoolUai: input.schoolUai,
          status: input.status,
          origin: source.origin,
          sourceId: source.id,
          sourceUrl: input.sourceUrl,
          sourceDomain: input.sourceDomain,
          moderation: decision.moderation,
          certainty: input.certainty,
          observedAt: input.observedAt,
          publishedAt: input.publishedAt,
          extractedObservedAt: input.extractedObservedAt,
          dateBasis: input.dateBasis,
          tier,
          hidden: source.reportsHidden,
          moderatedAt: decision.moderation === 'approved' ? new Date() : null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.reports.id })
      if (!row) return { outcome: 'duplicate' as const }
      if (verdict)
        await tx.insert(schema.judgements).values({
          reportId: row.id,
          provider: verdict.provider,
          model: verdict.model,
          probability: verdict.probability,
          nature: verdict.nature,
          level: verdict.level,
          natureProbabilities: verdict.natureProbabilities,
          levelProbabilities: verdict.levelProbabilities,
          chars: verdict.chars,
        })
      for (const id of decision.promote)
        await tx
          .update(schema.reports)
          .set({ moderation: 'approved', moderatedAt: new Date() })
          .where(eq(schema.reports.id, id))
      return {
        outcome: 'inserted' as const,
        reportId: row.id,
        moderation: decision.moderation as 'approved' | 'pending',
        reason: decision.reason,
        promoted: decision.promote.length,
      }
    })

    if (result.outcome === 'inserted' && this.bus) {
      const topic =
        result.moderation === 'approved' || result.promoted > 0 ? 'statuses' : 'moderation'
      void this.bus.publish({ topic, data: { uai: input.schoolUai } }).catch(() => {})
    }
    return result.outcome === 'inserted'
      ? {
          outcome: 'inserted',
          reportId: result.reportId,
          moderation: result.moderation,
          reason: result.reason,
        }
      : result
  }
}
