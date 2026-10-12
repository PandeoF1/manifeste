/**
 * The "resolve" stage turns each extracted fact into a report, or into the reason it is not one:
 *
 *   certainty → date (resolveObservation) → match (position, city, name) → weekend rule →
 *   judge (second opinion) → store (+ moderation)
 *
 * Every step is a rule of `@manifeste/core` or a port (matching, judge, report store); this file
 * only orders them and records what happened, so each decision is visible in the admin.
 */
import type { JudgeVerdict } from '@manifeste/ai'
import {
  canonicalUrl,
  eventNamedInText,
  extractDomain,
  isGenericSchoolName,
  isWeekendLyceeBlockade,
  levelOfName,
  meetsCertainty,
  pickByGeo,
  resolveObservation,
  type ExtractionOutcome,
  type SchoolLevel,
} from '@manifeste/core'
import { schema } from '@manifeste/db'
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { errorMessage, type IngestDeps } from './deps.ts'
import { inSpan, type PipelineEvent } from './events.ts'
import { mapLimit } from './http.ts'

export interface ResolveSweepResult {
  facts: number
  reports: number
  unmatched: number
  dropped: number
  failed: number
  more: boolean
}

export interface Fact {
  id: string
  itemId: string
  schoolName: string
  city: string | null
  status: 'blocked' | 'filtering' | 'lifted'
  certainty: 'high' | 'medium' | 'low'
  observedAtRaw: string | null
  sourceId: string
  runId: string | null
  url: string
  publishedAt: Date
  publisherDomain: string | null
  geoLat: number | null
  geoLng: number | null
  text: string
  title: string
  attempts: number
}

export type Decision = {
  outcome: ExtractionOutcome
  detail?: string
  uai?: string
  reportId?: string
}

const parisDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)

export async function resolveSweep(deps: IngestDeps): Promise<ResolveSweepResult> {
  const { db, config, events } = deps
  const result: ResolveSweepResult = {
    facts: 0,
    reports: 0,
    unmatched: 0,
    dropped: 0,
    failed: 0,
    more: false,
  }
  const started = performance.now()

  const loaded = await loadFacts(
    deps,
    and(isNull(schema.extractions.outcome), eq(schema.ingestItems.state, 'extracted')),
    config.resolveBatch + 1,
  )
  result.more = loaded.length > config.resolveBatch
  const facts = loaded.slice(0, config.resolveBatch)
  if (facts.length === 0) return result

  const judge = deps.ai.judge()
  let judgeCalls = 0
  const judgeBudgetEnds = Date.now() + 90_000
  const judgeOne: typeof judge = judge && {
    provider: judge.provider,
    model: judge.model,
    // The judge must never hold the collection back: a call cap, and none once the time is spent.
    async judge(input) {
      if (judgeCalls++ >= config.maxJudgeCalls || Date.now() > judgeBudgetEnds) return null
      try {
        return await judge.judge(input)
      } catch {
        return null
      }
    },
  }

  const decisions = await inSpan('ingest.resolve', { facts: facts.length }, () =>
    mapLimit(facts, 4, async (fact): Promise<Decision | { error: string }> => {
      try {
        return await decide(deps, fact, judgeOne)
      } catch (e) {
        return { error: errorMessage(e) }
      }
    }),
  )

  const out: PipelineEvent[] = []
  const touched = new Set<string>()
  for (const [i, fact] of facts.entries()) {
    const d = decisions[i] as Decision | { error: string }
    touched.add(fact.itemId)
    result.facts++
    if ('error' in d) {
      const exhausted = fact.attempts + 1 >= config.maxAttempts
      await db
        .update(schema.ingestItems)
        .set({
          attempts: sql`${schema.ingestItems.attempts} + 1`,
          ...(exhausted && {
            state: 'failed' as const,
            reason: `resolve: ${d.error}`.slice(0, 300),
          }),
        })
        .where(eq(schema.ingestItems.id, fact.itemId))
      if (exhausted)
        await db
          .update(schema.extractions)
          .set({ outcome: 'failed', outcomeDetail: d.error.slice(0, 300), resolvedAt: new Date() })
          .where(eq(schema.extractions.id, fact.id))
      result.failed++
      out.push({
        stage: 'store',
        outcome: 'failed',
        itemId: fact.itemId,
        sourceId: fact.sourceId,
        runId: fact.runId,
        detail: { error: d.error.slice(0, 200) },
      })
      continue
    }
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
    if (d.outcome === 'reported') result.reports++
    else if (d.outcome === 'unmatched') result.unmatched++
    else result.dropped++
    out.push({
      stage:
        d.outcome === 'unmatched'
          ? 'match'
          : d.outcome === 'reported' || d.outcome === 'duplicate'
            ? 'store'
            : stageOfDrop(d.outcome),
      outcome: d.outcome,
      itemId: fact.itemId,
      sourceId: fact.sourceId,
      runId: fact.runId,
      detail: {
        school: fact.schoolName,
        ...(d.uai && { uai: d.uai }),
        ...(d.detail && { detail: d.detail }),
      },
    })
  }

  // An item is done once none of its facts waits any more.
  if (touched.size > 0) {
    await db.execute(sql`
      update ingest_items i set state = 'done', reason = null, updated_at = now()
      where i.id in (${sql.join(
        [...touched].map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        and i.state = 'extracted'
        and not exists (select 1 from extractions e where e.item_id = i.id and e.outcome is null)`)
  }
  await events.emit(
    {
      stage: 'run',
      outcome: 'resolve',
      durationMs: performance.now() - started,
      detail: { ...result },
    },
    ...out,
  )
  await deps.aiUsage.flush()
  if (result.more) await deps.trigger('resolve')
  return result
}

/** The extracted facts matching a condition, with their item, source and text (oldest first). */
export async function loadFacts(
  deps: IngestDeps,
  where: SQL | undefined,
  limit: number,
): Promise<Fact[]> {
  const rows = await deps.db
    .select({
      id: schema.extractions.id,
      itemId: schema.extractions.itemId,
      schoolName: schema.extractions.schoolName,
      city: schema.extractions.city,
      status: schema.extractions.status,
      certainty: schema.extractions.certainty,
      observedAtRaw: schema.extractions.observedAtRaw,
      sourceId: schema.ingestItems.sourceId,
      runId: schema.ingestItems.runId,
      url: schema.ingestItems.url,
      publishedAt: schema.ingestItems.publishedAt,
      publisherDomain: schema.ingestItems.publisherDomain,
      geoLat: schema.ingestItems.geoLat,
      geoLng: schema.ingestItems.geoLng,
      attempts: schema.ingestItems.attempts,
      text: schema.itemContents.text,
      title: schema.itemContents.title,
    })
    .from(schema.extractions)
    .innerJoin(schema.ingestItems, eq(schema.ingestItems.id, schema.extractions.itemId))
    .leftJoin(schema.itemContents, eq(schema.itemContents.itemId, schema.ingestItems.id))
    .where(where)
    .orderBy(asc(schema.extractions.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, text: r.text ?? '', title: r.title ?? '' }))
}

/** The school a fact is about: the position of a map point first, then the city for a generic name, then the name. */
export async function findSchool(
  matching: IngestDeps['matching'],
  fact: Pick<Fact, 'schoolName' | 'city' | 'geoLat' | 'geoLng'>,
): Promise<string | null> {
  if (fact.geoLat !== null && fact.geoLng !== null) {
    const near = await matching.nearbyForGeo(fact.geoLat, fact.geoLng, 1500)
    const byPosition = pickByGeo(near, fact.schoolName)?.uai
    if (byPosition) return byPosition
  }
  if (fact.city && isGenericSchoolName(fact.schoolName, fact.city)) {
    // "Lycée de Hanches": matched only when the city has a single school of that level.
    const inCity = await matching.inCity(fact.city, 2, levelOfName(fact.schoolName) as SchoolLevel)
    return inCity.length === 1 ? (inCity[0]?.uai ?? null) : null
  }
  return (await matching.match(fact.schoolName, fact.city))?.uai ?? null
}

export interface DecideOptions {
  /** A school chosen elsewhere (the AI re-analysis, a staff member): skip the matching. */
  forceUai?: string
  /** Keep a row in the staff queue when no school is found (off when re-matching the queue itself). */
  recordUnmatched?: boolean
}

const stageOfDrop = (outcome: ExtractionOutcome): PipelineEvent['stage'] =>
  outcome === 'stale' || outcome === 'low_certainty' ? 'date' : 'store'

/** The decision for one fact, step by step. Throws only for what is worth a retry. */
export async function decide(
  deps: IngestDeps,
  fact: Fact,
  judge: ReturnType<IngestDeps['ai']['judge']>,
  options: DecideOptions = {},
): Promise<Decision> {
  const { db, config, matching } = deps
  if (!meetsCertainty(fact.certainty, config.minCertainty))
    return { outcome: 'low_certainty', detail: `certainty ${fact.certainty}` }

  // Date. A fact dated more than a week before its article is an archive or a retrospective.
  const observation = resolveObservation(fact.observedAtRaw, fact.publishedAt)
  if (observation.basis === 'stale')
    return { outcome: 'stale', detail: 'extracted date is more than 7 days before the article' }

  // The model must have taken this school from THIS article. One call handles many articles, so a
  // model that mixes them up, or obeys an instruction hidden in one text, reports a school the
  // article never mentions, and the report would carry the source (and the trust) of that
  // article. Map points (position) and staff choices (forceUai) are exempt.
  if (
    !options.forceUai &&
    fact.geoLat === null &&
    !eventNamedInText(fact, `${fact.title}\n${fact.text}`)
  )
    return { outcome: 'low_certainty', detail: 'the school is not named in the article text' }

  const uai = options.forceUai ?? (await findSchool(matching, fact))
  const sourceUrl = canonicalUrl(fact.url)
  if (!uai) {
    if (options.recordUnmatched === false) return { outcome: 'unmatched' }
    await db.insert(schema.unmatched).values({
      extractionId: fact.id,
      sourceId: fact.sourceId,
      sourceDomain: fact.publisherDomain ?? extractDomain(fact.url),
      // An excerpt for staff and the re-analysis; deleted with the text, after 7 days.
      context: fact.text.slice(0, 600),
      schoolName: fact.schoolName,
      city: fact.city,
      status: fact.status,
      sourceUrl,
      observedAt: observation.at,
    })
    return { outcome: 'unmatched' }
  }

  const domain = fact.publisherDomain ?? extractDomain(fact.url)
  if (!domain) return { outcome: 'no_source', uai, detail: 'unusable source link' }

  const [school] = await db
    .select({ name: schema.schools.name, city: schema.schools.city, level: schema.schools.level })
    .from(schema.schools)
    .where(eq(schema.schools.uai, uai))
  // A lycée is closed at weekends: a "blocked" dated Saturday or Sunday is a story or a summary
  // published that day, not a blockade. Higher education is exempt (occupations).
  if (isWeekendLyceeBlockade(fact.status, school?.level, observation.at))
    return { outcome: 'weekend', uai, detail: 'lycée closed at the weekend' }

  // Second opinion. Recorded with the report; it decides nothing here.
  let verdict: JudgeVerdict | null = null
  if (judge && school)
    verdict = await judge.judge({
      school: { name: school.name, city: school.city },
      status: fact.status,
      title: fact.title,
      text: fact.text,
      publishedDay: parisDay(fact.publishedAt),
    })

  const stored = await deps.reports.insert({
    schoolUai: uai,
    status: fact.status,
    sourceId: fact.sourceId,
    sourceUrl,
    sourceDomain: domain,
    certainty: fact.certainty,
    observedAt: observation.at,
    publishedAt: fact.publishedAt,
    extractedObservedAt: fact.observedAtRaw,
    dateBasis: observation.basis,
    verdict,
    schoolLevel: school?.level ?? null,
  })
  if (stored.outcome === 'duplicate') return { outcome: 'duplicate', uai }
  if (stored.outcome === 'no_source')
    return { outcome: 'no_source', uai, detail: 'source was deleted' }
  return {
    outcome: 'reported',
    uai,
    reportId: stored.reportId,
    detail: `${stored.moderation}: ${stored.reason}`,
  }
}
