/**
 * The "read" stage (fetch & normalise, then dedupe). Takes the items discovered and not yet read,
 * most recent first: reads the article behind each (`reader.ts`), merges the same article received
 * from several sources, and leaves each item ready for extraction, merged into another, or in the
 * `unreadable` lane when there is nothing to analyse.
 */
import { mergeSameArticle } from '@manifeste/core'
import { schema } from '@manifeste/db'
import { and, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm'
import { errorMessage, type IngestDeps } from './deps.ts'
import { inSpan, type PipelineEvent } from './events.ts'
import { readItems, type ReadOutput } from './reader.ts'

/** Below this much text, a page that could not be read leaves nothing worth sending to the AI. */
const MIN_USEFUL_CHARS = 60

export interface ReadSweepResult {
  read: number
  merged: number
  unreadable: number
  failed: number
  /** More items are waiting: run again. */
  more: boolean
}

interface Candidate {
  id: string
  sourceId: string
  runId: string | null
  kind: (typeof schema.sourceKind.enumValues)[number]
  url: string
  publishedAt: Date
  publisherDomain: string | null
  geo: boolean
  alwaysRelevant: boolean
  feedText: string
  attempts: number
}

export async function readSweep(deps: IngestDeps): Promise<ReadSweepResult> {
  const { db, config, events } = deps
  const result: ReadSweepResult = { read: 0, merged: 0, unreadable: 0, failed: 0, more: false }

  const rows = await db
    .select({
      id: schema.ingestItems.id,
      sourceId: schema.ingestItems.sourceId,
      runId: schema.ingestItems.runId,
      kind: schema.sources.kind,
      url: schema.ingestItems.url,
      publishedAt: schema.ingestItems.publishedAt,
      publisherDomain: schema.ingestItems.publisherDomain,
      geoLat: schema.ingestItems.geoLat,
      alwaysRelevant: schema.ingestItems.alwaysRelevant,
      attempts: schema.ingestItems.attempts,
      feedText: schema.itemContents.text,
    })
    .from(schema.ingestItems)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.ingestItems.sourceId))
    .leftJoin(schema.itemContents, eq(schema.itemContents.itemId, schema.ingestItems.id))
    .where(eq(schema.ingestItems.state, 'discovered'))
    .orderBy(desc(schema.ingestItems.publishedAt))
    .limit(config.readBatch + 1)
  result.more = rows.length > config.readBatch
  const batch: Candidate[] = rows.slice(0, config.readBatch).map((r) => ({
    id: r.id,
    sourceId: r.sourceId,
    runId: r.runId,
    kind: r.kind,
    url: r.url,
    publishedAt: r.publishedAt,
    publisherDomain: r.publisherDomain,
    geo: r.geoLat !== null,
    alwaysRelevant: r.alwaysRelevant,
    feedText: r.feedText ?? '',
    attempts: r.attempts,
  }))
  if (batch.length === 0) return result

  const out: PipelineEvent[] = []
  const recentCutoff = new Date(deps.now().getTime() - config.lookbackHours * 3_600_000)
  const batchIds = batch.map((c) => c.id)

  /** Items of recent passes that already hold the text of one of these addresses. */
  const readEarlier = async (urls: string[]) =>
    urls.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await db
              .select({ id: schema.ingestItems.id, url: schema.ingestItems.url })
              .from(schema.ingestItems)
              .where(
                and(
                  inArray(schema.ingestItems.url, urls),
                  inArray(schema.ingestItems.state, ['read', 'extracted', 'done', 'no_event']),
                  gte(schema.ingestItems.discoveredAt, recentCutoff),
                  notInArray(schema.ingestItems.id, batchIds),
                ),
              )
          ).map((k) => [k.url, k.id]),
        )

  // Duplicates are settled BEFORE any page is downloaded: the same article offered by five feeds,
  // or already read in a recent pass, used to be fetched and parsed each time and only then merged.
  const early = mergeSameArticle(
    batch.map((c) => ({
      id: c.id,
      url: c.url,
      text: c.feedText,
      geo: c.geo ? true : undefined,
      alwaysRelevant: c.alwaysRelevant,
    })),
  )
  for (const { item, into } of early.absorbed) {
    await markDuplicate(deps, item.id, into.id, 'same article in this batch')
    result.merged++
    out.push({
      stage: 'dedupe',
      outcome: 'duplicate',
      itemId: item.id,
      sourceId: batch.find((c) => c.id === item.id)?.sourceId ?? null,
      runId: batch.find((c) => c.id === item.id)?.runId ?? null,
      detail: { into: into.id },
    })
  }
  const plain = early.kept.filter((k) => !k.geo && !k.alwaysRelevant)
  const readBefore = await readEarlier(plain.map((k) => k.url))
  const toRead: Array<{ candidate: Candidate; text: string }> = []
  for (const k of early.kept) {
    const c = batch.find((b) => b.id === k.id)
    if (!c) continue
    const before = !c.geo && !c.alwaysRelevant ? readBefore.get(k.url) : undefined
    if (before) {
      await markDuplicate(deps, c.id, before, 'same article read earlier')
      result.merged++
      out.push({
        stage: 'dedupe',
        outcome: 'duplicate',
        itemId: c.id,
        sourceId: c.sourceId,
        runId: c.runId,
        detail: { into: before },
      })
      continue
    }
    toRead.push({ candidate: c, text: k.text })
  }

  const started = performance.now()
  let outputs: ReadOutput[]
  try {
    outputs = await inSpan('ingest.read', { items: batch.length }, () =>
      readItems(
        toRead.map(({ candidate: c, text }) => ({
          id: c.id,
          kind: c.kind,
          url: c.url,
          text,
          publishedAt: c.publishedAt,
          publisherDomain: c.publisherDomain,
        })),
        {
          fetchFn: deps.fetchFn,
          gateway: config.readerGateway,
          pageConcurrency: config.pageConcurrency,
        },
      ),
    )
  } catch (e) {
    // Nothing is known about any of them: count the attempt, try again next time.
    const failed = await failBatch(
      deps,
      toRead.map((r) => r.candidate),
      errorMessage(e),
    )
    return { ...result, failed, more: false }
  }
  const byId = new Map(batch.map((c) => [c.id, c]))
  const outById = new Map(outputs.map((o) => [o.id, o]))

  // The same article received twice in this batch (press feeds, Google News queries…): one item.
  const pending = outputs.map((o) => ({
    id: o.id,
    url: o.url,
    text: o.text,
    out: o,
    geo: byId.get(o.id)?.geo ? true : undefined,
    alwaysRelevant: byId.get(o.id)?.alwaysRelevant,
  }))
  const { kept, absorbed } = mergeSameArticle(pending)

  // …or, once the real address of a Google News link is known, read in a recent pass.
  const knownByUrl = await readEarlier(kept.map((k) => k.url))

  const sourceOf = (id: string) => byId.get(id)?.sourceId ?? null
  const runOf = (id: string) => byId.get(id)?.runId ?? null

  for (const { item, into } of absorbed) {
    await markDuplicate(deps, item.id, into.id, 'same article in this batch')
    result.merged++
    out.push({
      stage: 'dedupe',
      outcome: 'duplicate',
      itemId: item.id,
      sourceId: sourceOf(item.id),
      runId: runOf(item.id),
      detail: { into: into.id },
    })
  }

  for (const entry of kept) {
    const c = byId.get(entry.id)
    const o = outById.get(entry.id)
    if (!c || !o) continue
    const existing = !c.geo && !c.alwaysRelevant ? knownByUrl.get(o.url) : undefined
    if (existing && existing !== c.id) {
      await markDuplicate(deps, c.id, existing, 'same article read earlier')
      result.merged++
      out.push({
        stage: 'dedupe',
        outcome: 'duplicate',
        itemId: c.id,
        sourceId: c.sourceId,
        runId: c.runId,
        detail: { into: existing },
      })
      continue
    }
    const note = pageNote(o)
    const text = entry.text
    if (text.length < MIN_USEFUL_CHARS && (o.blocked || o.pageError)) {
      await db
        .update(schema.ingestItems)
        .set({ state: 'unreadable', reason: note ?? 'no text', url: o.url })
        .where(eq(schema.ingestItems.id, c.id))
      result.unreadable++
      out.push({
        stage: 'read',
        outcome: 'unreadable',
        itemId: c.id,
        sourceId: c.sourceId,
        runId: c.runId,
        detail: { reason: note },
      })
      continue
    }
    await db
      .insert(schema.itemContents)
      .values({ itemId: c.id, title: o.title, text, chars: text.length, strategy: o.strategy })
      .onConflictDoUpdate({
        target: schema.itemContents.itemId,
        set: {
          title: o.title,
          text,
          chars: text.length,
          strategy: o.strategy,
          fetchedAt: sql`now()`,
        },
      })
    await db
      .update(schema.ingestItems)
      .set({
        state: 'read',
        reason: note,
        url: o.url,
        publisherDomain: o.publisherDomain,
        publishedAt: o.publishedAt,
        attempts: 0,
      })
      .where(eq(schema.ingestItems.id, c.id))
    result.read++
    out.push({
      stage: 'read',
      outcome: 'ok',
      itemId: c.id,
      sourceId: c.sourceId,
      runId: c.runId,
      detail: {
        strategy: o.strategy,
        chars: text.length,
        page: o.pageChars,
        ...(note && { note }),
      },
    })
  }
  await events.emit(
    {
      stage: 'run',
      outcome: 'read',
      durationMs: performance.now() - started,
      detail: { ...result },
    },
    ...out,
  )
  if (result.read > 0) {
    await deps.trigger('extract')
    await deps.trigger('media')
    await deps.trigger('routes')
  }
  return result
}

/** Why the page itself was not used, for the event and the lane. */
const pageNote = (o: ReadOutput): string | null =>
  o.blocked ? `page: ${o.blocked.reason}` : o.pageError ? `page: ${o.pageError}` : null

async function markDuplicate(deps: IngestDeps, id: string, into: string, reason: string) {
  await deps.db
    .update(schema.ingestItems)
    .set({ state: 'duplicate', reason, mergedInto: into })
    .where(eq(schema.ingestItems.id, id))
}

/** Counts a failed attempt; past the limit the item goes to the failed lane. */
async function failBatch(
  deps: IngestDeps,
  batch: readonly Candidate[],
  message: string,
): Promise<number> {
  const out: PipelineEvent[] = []
  for (const c of batch) {
    const exhausted = c.attempts + 1 >= deps.config.maxAttempts
    await deps.db
      .update(schema.ingestItems)
      .set({
        attempts: c.attempts + 1,
        ...(exhausted && { state: 'failed' as const, reason: `read: ${message}`.slice(0, 300) }),
      })
      .where(eq(schema.ingestItems.id, c.id))
    out.push({
      stage: 'read',
      outcome: 'failed',
      itemId: c.id,
      sourceId: c.sourceId,
      runId: c.runId,
      detail: { error: message.slice(0, 200), attempt: c.attempts + 1 },
    })
  }
  await deps.events.emit(...out)
  return batch.length
}
