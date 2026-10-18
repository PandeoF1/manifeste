/**
 * Operations on the data already collected, which used to be one-off scripts. Each takes a scope
 * and a dry-run flag (a dry run costs nothing and says what would happen), can be started from
 * the admin (it runs as a job) or from the command line (`src/cli/ingest.ts`), and reports what
 * it did.
 *
 *   backfill   read the sources again over a longer window (after adding a source, or an outage)
 *   reextract  run the AI again on items already analysed (after a prompt or model change)
 *   rejudge    ask the judge about reports that have no second opinion
 *   rematch    try again to find the school of the facts waiting in the staff queue
 */
import { reanalyse, type JudgeVerdict, type ReanalyseItem } from '@manifeste/ai'
import { isForeignPlace } from '@manifeste/core'
import { schema } from '@manifeste/db'
import { trace } from '@opentelemetry/api'
import { and, eq, gte, inArray, isNull, notExists, sql } from 'drizzle-orm'
import { errorMessage, type IngestDeps } from './deps.ts'
import { inSpan } from '../telemetry/trace.ts'
import { discoverSource } from './discover.ts'
import { chunk, mapLimit } from './http.ts'
import { readItems } from './reader.ts'
import { computeTier } from './report-store.ts'
import { decide, findSchool, loadFacts, OUTSIDE_FRANCE, type Decision } from './resolve-stage.ts'
import { linkUnmatched } from './staff-actions.ts'
import type { IngestService } from './service.ts'

export const OPERATION_KINDS = ['backfill', 'reextract', 'rejudge', 'rematch'] as const

export type Operation =
  | { kind: 'backfill'; sinceHours: number; sourceId?: string }
  | { kind: 'reextract'; sinceHours: number; sourceId?: string }
  | { kind: 'rejudge'; sinceHours: number; limit?: number }
  | { kind: 'rematch'; limit?: number; useAi?: boolean }

export interface OperationResult {
  kind: Operation['kind']
  dryRun: boolean
  summary: Record<string, number | string>
}

/** Jev bills 42 USD per billion input tokens; an article focus is about 600 tokens. */
const JUDGE_USD_PER_REPORT = (600 * 42) / 1e9

export class IngestOperations {
  constructor(private readonly ingest: IngestService) {}

  private get deps(): IngestDeps {
    return this.ingest.deps
  }

  async run(op: Operation, options: { dryRun: boolean }): Promise<OperationResult> {
    const started = performance.now()
    await this.deps.events.emit({
      stage: 'job',
      outcome: 'started',
      detail: { ...op, dryRun: options.dryRun },
    })
    let summary: OperationResult['summary']
    try {
      summary =
        op.kind === 'backfill'
          ? await this.backfill(op, options.dryRun)
          : op.kind === 'reextract'
            ? await this.reextract(op, options.dryRun)
            : op.kind === 'rejudge'
              ? await this.rejudge(op, options.dryRun)
              : await this.rematch(op, options.dryRun)
    } catch (e) {
      await this.deps.events.emit({
        stage: 'job',
        outcome: 'failed',
        durationMs: performance.now() - started,
        detail: { kind: op.kind, error: errorMessage(e).slice(0, 300) },
      })
      throw e
    }
    await this.deps.events.emit({
      stage: 'job',
      outcome: options.dryRun ? 'dry-run' : 'completed',
      durationMs: performance.now() - started,
      detail: { kind: op.kind, ...summary },
    })
    return { kind: op.kind, dryRun: options.dryRun, summary }
  }

  // --- backfill ---------------------------------------------------------------------------

  private async backfill(
    op: Extract<Operation, { kind: 'backfill' }>,
    dryRun: boolean,
  ): Promise<OperationResult['summary']> {
    const sources = await this.deps.db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.enabled, true),
          op.sourceId ? eq(schema.sources.id, op.sourceId) : undefined,
        ),
      )
    if (dryRun) return { sources: sources.length, sinceHours: op.sinceHours }
    // The same stages as a normal pass, with a longer memory.
    const wide: IngestDeps = {
      ...this.deps,
      config: { ...this.deps.config, lookbackHours: op.sinceHours },
    }
    let fetched = 0
    let newItems = 0
    let relevant = 0
    let failed = 0
    for (const { id } of sources) {
      const r = await discoverSource(wide, id, 'manual')
      fetched += r.fetched
      newItems += r.newItems
      relevant += r.relevant
      if (r.error) failed++
    }
    await this.ingest.drain(50)
    return { sources: sources.length, failedSources: failed, fetched, newItems, relevant }
  }

  // --- reextract --------------------------------------------------------------------------

  private async reextract(
    op: Extract<Operation, { kind: 'reextract' }>,
    dryRun: boolean,
  ): Promise<OperationResult['summary']> {
    const { db, config } = this.deps
    const since = new Date(this.deps.now().getTime() - op.sinceHours * 3_600_000)
    const items = await db
      .select({
        id: schema.ingestItems.id,
        kind: schema.sources.kind,
        hasContent: sql<boolean>`${schema.itemContents.itemId} is not null`,
      })
      .from(schema.ingestItems)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.ingestItems.sourceId))
      .leftJoin(schema.itemContents, eq(schema.itemContents.itemId, schema.ingestItems.id))
      .where(
        and(
          gte(schema.ingestItems.discoveredAt, since),
          inArray(schema.ingestItems.state, ['done', 'no_event', 'extracted']),
          op.sourceId ? eq(schema.ingestItems.sourceId, op.sourceId) : undefined,
        ),
      )
    // The text of an item is kept 7 days. A press article can be fetched again; a post cannot.
    const withText = items.filter((i) => i.hasContent).map((i) => i.id)
    const refetch = items.filter((i) => !i.hasContent && i.kind === 'rss').map((i) => i.id)
    const lost = items.length - withText.length - refetch.length
    const calls = Math.ceil((withText.length + refetch.length) / config.extractBatchSize)
    if (dryRun)
      return {
        items: items.length,
        fromStoredText: withText.length,
        refetched: refetch.length,
        unrecoverable: lost,
        estimatedAiCalls: calls,
      }
    if (withText.length)
      await db
        .update(schema.ingestItems)
        .set({ state: 'read', reason: null, attempts: 0 })
        .where(inArray(schema.ingestItems.id, withText))
    if (refetch.length)
      await db
        .update(schema.ingestItems)
        .set({ state: 'discovered', reason: null, attempts: 0 })
        .where(inArray(schema.ingestItems.id, refetch))
    await this.ingest.drain(50)
    return {
      items: items.length,
      fromStoredText: withText.length,
      refetched: refetch.length,
      unrecoverable: lost,
      estimatedAiCalls: calls,
    }
  }

  // --- rejudge ----------------------------------------------------------------------------

  private async rejudge(
    op: Extract<Operation, { kind: 'rejudge' }>,
    dryRun: boolean,
  ): Promise<OperationResult['summary']> {
    const { db, config } = this.deps
    const since = new Date(this.deps.now().getTime() - op.sinceHours * 3_600_000)
    const candidates = await db
      .select({
        id: schema.reports.id,
        status: schema.reports.status,
        url: schema.reports.sourceUrl,
        domain: schema.reports.sourceDomain,
        observedAt: schema.reports.observedAt,
        publishedAt: schema.reports.publishedAt,
        name: schema.schools.name,
        city: schema.schools.city,
        level: schema.schools.level,
      })
      .from(schema.reports)
      .innerJoin(schema.schools, eq(schema.schools.uai, schema.reports.schoolUai))
      .where(
        and(
          gte(schema.reports.createdAt, since),
          sql`${schema.reports.origin} <> 'on_site'`,
          sql`${schema.reports.sourceUrl} is not null`,
          notExists(
            db
              .select({ one: sql`1` })
              .from(schema.judgements)
              .where(eq(schema.judgements.reportId, schema.reports.id)),
          ),
        ),
      )
      .orderBy(sql`${schema.reports.createdAt} desc`)
      .limit(op.limit ?? 500)
    const judge = this.deps.ai.judge()
    if (dryRun || !judge)
      return {
        reports: candidates.length,
        estimatedUsd: Number((candidates.length * JUDGE_USD_PER_REPORT).toFixed(6)),
        ...(judge ? {} : { note: 'the judge is switched off' }),
      }

    const settings = await this.deps.settings.all()
    let judged = 0
    let unreadable = 0
    await mapLimit(candidates, 4, (r) =>
      inSpan(
        'ingest.rejudge.report',
        { 'report.id': r.id, 'source.domain': r.domain ?? '' },
        async () => {
          const url = r.url
          if (!url) return
          const [read] = await inSpan(
            'ingest.read',
            { 'source.domain': r.domain ?? '' },
            async () => {
              const out = await readItems(
                [
                  {
                    id: r.id,
                    kind: 'rss',
                    url,
                    text: '',
                    publishedAt: r.publishedAt ?? r.observedAt,
                    publisherDomain: r.domain,
                  },
                ],
                { fetchFn: this.deps.fetchFn, gateway: config.readerGateway },
              )
              trace.getActiveSpan()?.setAttribute('article.chars', out[0]?.text.length ?? 0)
              return out
            },
          )
          if (!read || read.text.length < 300) {
            trace.getActiveSpan()?.setAttribute('rejudge.outcome', 'unreadable')
            unreadable++
            return
          }
          const verdict: JudgeVerdict | null = await inSpan(
            'ingest.judge',
            { 'article.chars': read.text.length },
            async () => {
              const v = await judge
                .judge({
                  school: { name: r.name, city: r.city },
                  status: r.status,
                  title: read.title,
                  text: read.text,
                  publishedDay: new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Europe/Paris',
                  }).format(r.publishedAt ?? r.observedAt),
                })
                .catch((e: unknown) => {
                  // Recorded on the span, then the report stays unjudged: the next pass tries again.
                  trace
                    .getActiveSpan()
                    ?.recordException(e instanceof Error ? e : new Error(String(e)))
                  return null
                })
              if (v)
                trace.getActiveSpan()?.setAttributes({
                  'judge.model': v.model,
                  'judge.probability': v.probability,
                  'judge.nature': v.nature ?? '',
                  'judge.level': v.level ?? '',
                })
              return v
            },
          )
          if (!verdict) {
            trace.getActiveSpan()?.setAttribute('rejudge.outcome', 'no-verdict')
            unreadable++
            return
          }
          await db.transaction(async (tx) => {
            await tx
              .insert(schema.judgements)
              .values({
                reportId: r.id,
                provider: verdict.provider,
                model: verdict.model,
                probability: verdict.probability,
                nature: verdict.nature,
                level: verdict.level,
                natureProbabilities: verdict.natureProbabilities,
                levelProbabilities: verdict.levelProbabilities,
                chars: verdict.chars,
              })
              .onConflictDoNothing()
            await tx
              .update(schema.reports)
              .set({
                tier: computeTier(verdict, r.status, r.level, {
                  keep: settings.judge_keep,
                  low: settings.judge_low,
                }),
              })
              .where(eq(schema.reports.id, r.id))
          })
          trace.getActiveSpan()?.setAttribute('rejudge.outcome', 'judged')
          judged++
        },
      ),
    )
    await this.deps.aiUsage.flush()
    return { reports: candidates.length, judged, unreadable }
  }

  // --- rematch ----------------------------------------------------------------------------

  private async rematch(
    op: Extract<Operation, { kind: 'rematch' }>,
    dryRun: boolean,
  ): Promise<OperationResult['summary']> {
    const { db } = this.deps
    const open = await db
      .select({
        id: schema.unmatched.id,
        extractionId: schema.unmatched.extractionId,
        context: schema.unmatched.context,
      })
      .from(schema.unmatched)
      .where(
        and(isNull(schema.unmatched.resolvedAt), sql`${schema.unmatched.extractionId} is not null`),
      )
      .orderBy(schema.unmatched.createdAt)
      .limit(op.limit ?? 500)
    const useAi = Boolean(op.useAi) && this.deps.ai.config.enabled
    // Rows whose extraction is gone (imported from the previous site, or deleted): they carry the
    // name, city, status and source themselves, so they are attached from those.
    const orphans = await db
      .select({
        id: schema.unmatched.id,
        schoolName: schema.unmatched.schoolName,
        city: schema.unmatched.city,
        status: schema.unmatched.status,
        context: schema.unmatched.context,
        sourceUrl: schema.unmatched.sourceUrl,
      })
      .from(schema.unmatched)
      .where(and(isNull(schema.unmatched.resolvedAt), isNull(schema.unmatched.extractionId)))
      .orderBy(schema.unmatched.createdAt)
      .limit(op.limit ?? 500)
    if (dryRun)
      return {
        waiting: open.length + orphans.length,
        withoutExtraction: orphans.length,
        estimatedAiCalls: useAi ? Math.ceil((open.length + orphans.length) / 20) : 0,
      }

    const judge = this.deps.ai.judge()
    let matched = 0
    let foreign = 0
    let reports = 0
    const still: Array<{ rowId: string; fact: Awaited<ReturnType<typeof loadFacts>>[number] }> = []

    const apply = async (
      rowId: string,
      fact: Awaited<ReturnType<typeof loadFacts>>[number],
      d: Decision,
    ) => {
      await db
        .update(schema.extractions)
        .set({
          outcome: d.outcome,
          outcomeDetail: d.detail ?? null,
          schoolUai: d.uai ?? null,
          reportId: d.reportId ?? null,
          resolvedAt: new Date(),
        })
        .where(eq(schema.extractions.id, fact.id))
      await db
        .update(schema.unmatched)
        .set({
          resolvedAt: new Date(),
          resolution: d.detail === OUTSIDE_FRANCE ? 'foreign' : d.uai ? 'matched' : 'dismissed',
          linkedUai: d.uai ?? null,
        })
        .where(eq(schema.unmatched.id, rowId))
      matched++
      if (d.outcome === 'reported') reports++
    }

    for (const row of open) {
      const [fact] = await loadFacts(
        this.deps,
        eq(schema.extractions.id, row.extractionId ?? ''),
        1,
      )
      if (!fact) continue
      // The text may be gone (7 days): the excerpt kept for the queue is what is left.
      const withText = { ...fact, text: fact.text || row.context || '' }
      const d = await decide(this.deps, withText, judge, { recordUnmatched: false })
      if (d.outcome === 'unmatched') still.push({ rowId: row.id, fact: withText })
      else await apply(row.id, withText, d)
    }

    if (useAi && still.length > 0) {
      const chain = this.deps.ai.reanalyseChain()
      for (const group of chunk(still, 20)) {
        const items: ReanalyseItem[] = []
        for (const { rowId, fact } of group)
          items.push({
            id: rowId,
            schoolName: fact.schoolName,
            city: fact.city,
            status: fact.status,
            context: [fact.title, fact.text.slice(0, 1500)].filter(Boolean).join('\n'),
            candidates: (await this.deps.matching.candidates(fact.schoolName, fact.city, 8)).map(
              (c) => ({
                uai: c.uai,
                name: c.name,
                city: c.city,
                department: null,
              }),
            ),
          })
        let chosen: Map<string, string>
        try {
          chosen = await reanalyse(chain, items)
        } catch {
          break // the AI is unavailable: what is left stays in the queue
        }
        for (const { rowId, fact } of group) {
          const uai = chosen.get(rowId)
          if (!uai) continue
          const d = await decide(this.deps, fact, judge, { forceUai: uai, recordUnmatched: false })
          if (d.outcome !== 'unmatched') await apply(rowId, fact, d)
        }
      }
      await this.deps.aiUsage.flush()
    }

    const left: typeof orphans = []
    for (const row of orphans) {
      const uai = await findSchool(this.deps.matching, {
        schoolName: row.schoolName,
        city: row.city,
        geoLat: null,
        geoLng: null,
        text: row.context ?? '',
        url: row.sourceUrl,
      })
      if (uai && (await linkUnmatched(this.deps, row.id, uai, null)).ok) matched++
      else if (!uai && isForeignPlace(row.city)) {
        // A school abroad is not in the directory: closed here, not left for staff.
        await db
          .update(schema.unmatched)
          .set({ resolvedAt: new Date(), resolution: 'foreign', context: null })
          .where(and(eq(schema.unmatched.id, row.id), isNull(schema.unmatched.resolvedAt)))
        foreign++
      } else left.push(row)
    }
    if (useAi && left.length > 0) {
      const chain = this.deps.ai.reanalyseChain()
      for (const group of chunk(left, 20)) {
        const items: ReanalyseItem[] = []
        for (const row of group)
          items.push({
            id: row.id,
            schoolName: row.schoolName,
            city: row.city,
            status: row.status,
            context: row.context ?? '',
            candidates: (await this.deps.matching.candidates(row.schoolName, row.city, 8)).map(
              (c) => ({ uai: c.uai, name: c.name, city: c.city, department: null }),
            ),
          })
        let chosen: Map<string, string>
        try {
          chosen = await reanalyse(chain, items)
        } catch {
          break
        }
        for (const row of group) {
          const uai = chosen.get(row.id)
          if (uai && (await linkUnmatched(this.deps, row.id, uai, null)).ok) matched++
        }
      }
      await this.deps.aiUsage.flush()
    }
    const total = open.length + orphans.length
    return { waiting: total, matched, foreign, reports, stillUnmatched: total - matched - foreign }
  }
}
