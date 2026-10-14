/**
 * The "extract" stage: the AI reads the items that are ready and says which schools are blocked,
 * filtering or lifted. One call handles many items (the cost is in the input tokens, and the
 * prompt is paid once per call), across every source. Items the AI cannot be asked about (switch
 * off, budget reached, billing) wait in the `deferred` lane and come back by themselves.
 */
import { AiError, extractBatch, type ExtractItem } from '@manifeste/ai'
import { schema } from '@manifeste/db'
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm'
import { errorMessage, type IngestDeps } from './deps.ts'
import { inSpan, type PipelineEvent } from './events.ts'
import { chunk } from './http.ts'

export interface ExtractSweepResult {
  extracted: number
  noEvent: number
  deferred: number
  failed: number
  calls: number
  more: boolean
}

/** Errors that will repeat on every call: no point trying the next batch. */
const STOPPING = new Set(['billing', 'budget', 'disabled', 'auth'])

/** Can the AI be asked right now? */
async function aiUsable(deps: IngestDeps): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { config } = deps.ai
  if (!config.enabled) return { ok: false, reason: 'ai:disabled' }
  if (config.budget.dailyUsd > 0 && (await deps.aiUsage.spentToday()) >= config.budget.dailyUsd)
    return { ok: false, reason: 'ai:budget' }
  return { ok: true }
}

export async function extractSweep(deps: IngestDeps): Promise<ExtractSweepResult> {
  const { db, config, events, ai } = deps
  const result: ExtractSweepResult = {
    extracted: 0,
    noEvent: 0,
    deferred: 0,
    failed: 0,
    calls: 0,
    more: false,
  }

  const usable = await aiUsable(deps)
  if (usable.ok) {
    // The AI is back: what waited for it goes first in line again.
    await db
      .update(schema.ingestItems)
      .set({ state: 'read', reason: null })
      .where(and(eq(schema.ingestItems.state, 'deferred'), like(schema.ingestItems.reason, 'ai:%')))
  }

  const limit = config.extractBatchSize * config.maxExtractCalls
  const rows = await db
    .select({
      id: schema.ingestItems.id,
      sourceId: schema.ingestItems.sourceId,
      runId: schema.ingestItems.runId,
      publishedAt: schema.ingestItems.publishedAt,
      attempts: schema.ingestItems.attempts,
      alwaysRelevant: schema.ingestItems.alwaysRelevant,
      text: schema.itemContents.text,
    })
    .from(schema.ingestItems)
    .innerJoin(schema.itemContents, eq(schema.itemContents.itemId, schema.ingestItems.id))
    .where(eq(schema.ingestItems.state, 'read'))
    // Oldest first: a fact loses value by the hour, but nothing may starve.
    .orderBy(asc(schema.ingestItems.publishedAt))
    .limit(limit + 1)
  result.more = rows.length > limit
  const items = rows.slice(0, limit)
  if (items.length === 0) return result

  const defer = async (ids: string[], reason: string, why: PipelineEvent['detail'] = {}) => {
    if (ids.length === 0) return
    await db
      .update(schema.ingestItems)
      .set({ state: 'deferred', reason })
      .where(inArray(schema.ingestItems.id, ids))
    result.deferred += ids.length
    await events.emit({
      stage: 'extract',
      outcome: 'deferred',
      detail: { items: ids.length, reason, ...why },
    })
  }

  if (!usable.ok) {
    await defer(
      items.map((i) => i.id),
      usable.reason,
    )
    return { ...result, more: false }
  }

  const chain = ai.extractChain()
  const started = performance.now()
  const groups = chunk(items, config.extractBatchSize)
  for (const [index, group] of groups.entries()) {
    // Short ids in the prompt: a UUID per item would cost tokens for nothing.
    const request: ExtractItem[] = group.map((g, i) => ({
      id: String(i),
      publishedAt: g.publishedAt,
      text: g.text,
      map: g.alwaysRelevant,
    }))
    const t0 = performance.now()
    let answer
    try {
      answer = await inSpan('ingest.extract', { items: group.length }, () =>
        extractBatch(chain, request, {
          prompt: ai.config.tasks.extract.prompt,
          textChars: ai.config.tasks.extract.textChars,
        }),
      )
      result.calls++
    } catch (e) {
      const kind = e instanceof AiError ? e.kind : 'unavailable'
      if (STOPPING.has(kind)) {
        await defer(
          groups.slice(index).flatMap((g) => g.map((i) => i.id)),
          `ai:${kind}`,
          { error: errorMessage(e).slice(0, 200) },
        )
        break
      }
      result.failed += await failItems(deps, group, errorMessage(e))
      continue
    }
    if (!answer) continue

    const byIndex = new Map<string, typeof answer.events>()
    for (const event of answer.events)
      byIndex.set(event.itemId, [...(byIndex.get(event.itemId) ?? []), event])
    const out: PipelineEvent[] = []
    for (const [i, item] of group.entries()) {
      const found = byIndex.get(String(i)) ?? []
      if (found.length === 0 && answer.dropped > 0 && item.attempts + 1 < config.maxAttempts) {
        // The model answered, but with events nobody could use: that is not "no fact". Ask again
        // later instead of closing the item for good.
        await db
          .update(schema.ingestItems)
          .set({ attempts: sql`${schema.ingestItems.attempts} + 1` })
          .where(eq(schema.ingestItems.id, item.id))
        out.push({
          stage: 'extract',
          outcome: 'retry',
          itemId: item.id,
          sourceId: item.sourceId,
          runId: item.runId,
          detail: { reason: 'unusable events', dropped: answer.dropped },
        })
        continue
      }
      if (found.length === 0) {
        await db
          .update(schema.ingestItems)
          .set({ state: 'no_event', reason: 'the AI found no fact' })
          .where(eq(schema.ingestItems.id, item.id))
        result.noEvent++
        out.push({
          stage: 'extract',
          outcome: 'no_event',
          itemId: item.id,
          sourceId: item.sourceId,
          runId: item.runId,
          durationMs: performance.now() - t0,
        })
        continue
      }
      await db.transaction(async (tx) => {
        await tx.insert(schema.extractions).values(
          found.map((e) => ({
            itemId: item.id,
            schoolName: e.schoolName,
            city: e.city,
            status: e.status,
            certainty: e.certainty,
            observedAtRaw: e.observedAt,
            nature: e.nature ?? null,
            provider: answer.provider,
            model: answer.model,
            promptVersion: answer.promptVersion,
          })),
        )
        await tx
          .update(schema.ingestItems)
          .set({ state: 'extracted', reason: null, attempts: 0 })
          .where(eq(schema.ingestItems.id, item.id))
      })
      result.extracted++
      out.push({
        stage: 'extract',
        outcome: 'extracted',
        itemId: item.id,
        sourceId: item.sourceId,
        runId: item.runId,
        durationMs: performance.now() - t0,
        detail: {
          facts: found.length,
          model: answer.model,
          ...(answer.dropped > 0 && { dropped: answer.dropped }),
        },
      })
    }
    await events.emit(...out)
  }
  await events.emit({
    stage: 'run',
    outcome: 'extract',
    durationMs: performance.now() - started,
    detail: { ...result },
  })
  await deps.aiUsage.flush()
  if (result.extracted > 0) await deps.trigger('resolve')
  if (result.more && result.deferred === 0) await deps.trigger('extract')
  return result
}

async function failItems(
  deps: IngestDeps,
  group: ReadonlyArray<{ id: string; sourceId: string; runId: string | null; attempts: number }>,
  message: string,
): Promise<number> {
  const out: PipelineEvent[] = []
  for (const item of group) {
    const exhausted = item.attempts + 1 >= deps.config.maxAttempts
    await deps.db
      .update(schema.ingestItems)
      .set({
        attempts: sql`${schema.ingestItems.attempts} + 1`,
        ...(exhausted && { state: 'failed' as const, reason: `extract: ${message}`.slice(0, 300) }),
      })
      .where(eq(schema.ingestItems.id, item.id))
    out.push({
      stage: 'extract',
      outcome: 'failed',
      itemId: item.id,
      sourceId: item.sourceId,
      runId: item.runId,
      detail: { error: message.slice(0, 200), attempt: item.attempts + 1 },
    })
  }
  await deps.events.emit(...out)
  return group.length
}
