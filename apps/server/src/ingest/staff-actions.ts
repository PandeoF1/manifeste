/** What staff do to the queue of unmatched facts: link one to a school, or dismiss it. */
import { schema } from '@manifeste/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { IngestDeps } from './deps.ts'
import { decide, loadFacts } from './resolve-stage.ts'

export type LinkResult =
  | { ok: true; outcome: string; reportId: string | null }
  | { ok: false; reason: 'unknown' | 'resolved' | 'unknown-school' }

export async function linkUnmatched(
  deps: IngestDeps,
  id: string,
  uai: string,
  userId: string,
): Promise<LinkResult> {
  const { db } = deps
  const [row] = await db.select().from(schema.unmatched).where(eq(schema.unmatched.id, id))
  if (!row) return { ok: false, reason: 'unknown' }
  if (row.resolvedAt) return { ok: false, reason: 'resolved' }
  const [school] = await db
    .select({ level: schema.schools.level, name: schema.schools.name, city: schema.schools.city })
    .from(schema.schools)
    .where(eq(schema.schools.uai, uai))
  if (!school) return { ok: false, reason: 'unknown-school' }

  let outcome: string
  let reportId: string | null
  const [fact] = row.extractionId
    ? await loadFacts(deps, eq(schema.extractions.id, row.extractionId), 1)
    : []
  if (fact) {
    const d = await decide(deps, { ...fact, text: fact.text || row.context || '' }, null, {
      forceUai: uai,
      recordUnmatched: false,
    })
    outcome = d.outcome
    reportId = d.reportId ?? null
    await db
      .update(schema.extractions)
      .set({
        outcome: d.outcome,
        outcomeDetail: d.detail ?? null,
        schoolUai: uai,
        reportId,
        resolvedAt: new Date(),
      })
      .where(eq(schema.extractions.id, fact.id))
  } else {
    // The extraction is gone: the row itself carries what is needed.
    const domain = row.sourceDomain
    if (!row.sourceId || !domain) return { ok: false, reason: 'unknown' }
    const stored = await deps.reports.insert({
      schoolUai: uai,
      status: row.status,
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      sourceDomain: domain,
      certainty: 'medium',
      observedAt: row.observedAt,
      publishedAt: row.observedAt,
      extractedObservedAt: null,
      dateBasis: 'published',
      verdict: null,
      schoolLevel: school.level,
    })
    outcome = stored.outcome === 'inserted' ? 'reported' : stored.outcome
    reportId = stored.outcome === 'inserted' ? stored.reportId : null
  }
  await db
    .update(schema.unmatched)
    .set({ resolvedAt: new Date(), resolvedBy: userId, resolution: 'linked', linkedUai: uai })
    .where(and(eq(schema.unmatched.id, id), isNull(schema.unmatched.resolvedAt)))
  return { ok: true, outcome, reportId }
}

export async function dismissUnmatched(
  deps: IngestDeps,
  id: string,
  userId: string,
): Promise<boolean> {
  const done = await deps.db
    .update(schema.unmatched)
    .set({ resolvedAt: new Date(), resolvedBy: userId, resolution: 'dismissed', context: null })
    .where(and(eq(schema.unmatched.id, id), isNull(schema.unmatched.resolvedAt)))
    .returning({ id: schema.unmatched.id })
  return done.length > 0
}
