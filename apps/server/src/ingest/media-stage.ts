/**
 * The media stage, beside the main flow: for press articles that were read, how does the article
 * treat the mobilisation (demands set out? who speaks? incidents or mobilisation angle?). It never
 * holds the flow back (it has its own sweep and AI-call cap) and stores answers, not text.
 */
import { AiError, analyseMedia } from '@manifeste/ai'
import { extractDomain } from '@manifeste/core'
import { schema } from '@manifeste/db'
import { and, desc, eq, gte, inArray, notExists, sql } from 'drizzle-orm'
import type { IngestDeps } from './deps.ts'
import { inSpan } from './events.ts'
import { takeBatches } from './batching.ts'
import { chunk } from './http.ts'

export interface MediaSweepResult {
  analysed: number
  calls: number
  more: boolean
}

/** The title of an item: the first non-empty line of its text. */
const titleOf = (text: string, stored: string): string =>
  (stored || (text.split('\n').find((l) => l.trim()) ?? '')).trim().slice(0, 300)

export async function mediaSweep(deps: IngestDeps): Promise<MediaSweepResult> {
  const { db, config, ai } = deps
  const result: MediaSweepResult = { analysed: 0, calls: 0, more: false }
  if (!config.mediaAnalysis || !ai.config.enabled) return result
  // The admin switch (Réglages): off stops the AI calls at once, what was analysed stays.
  if (!(await deps.settings.all()).media_analysis) return result

  const since = new Date(deps.now().getTime() - config.contentRetentionDays * 86_400_000)
  const limit = config.mediaBatchSize * config.maxMediaCalls
  const rows = await db
    .select({
      id: schema.ingestItems.id,
      sourceId: schema.ingestItems.sourceId,
      url: schema.ingestItems.url,
      publishedAt: schema.ingestItems.publishedAt,
      publisherDomain: schema.ingestItems.publisherDomain,
      waitingSince: schema.ingestItems.discoveredAt,
      text: schema.itemContents.text,
      title: schema.itemContents.title,
    })
    .from(schema.ingestItems)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.ingestItems.sourceId))
    .innerJoin(schema.itemContents, eq(schema.itemContents.itemId, schema.ingestItems.id))
    .where(
      and(
        eq(schema.sources.kind, 'rss'),
        inArray(schema.ingestItems.state, ['read', 'extracted', 'done', 'no_event']),
        eq(schema.ingestItems.scope, 'school'),
        gte(schema.ingestItems.discoveredAt, since),
        sql`${schema.ingestItems.url} not like 'https://news.google.com/%'`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.mediaAnalyses)
            .where(eq(schema.mediaAnalyses.url, schema.ingestItems.url)),
        ),
      ),
    )
    .orderBy(desc(schema.ingestItems.publishedAt))
    .limit(limit + 1)
  result.more = rows.length > limit
  const items = takeBatches(
    rows.slice(0, limit),
    config.mediaBatchSize,
    config.mediaMaxWaitMinutes * 60_000,
    deps.now(),
  )
  if (items.length === 0) return { ...result, more: false }

  const chain = ai.mediaChain()
  for (const group of chunk(items, config.mediaBatchSize)) {
    const request = group.map((g, i) => ({ id: String(i), text: g.text }))
    let analyses
    try {
      analyses = await inSpan('ingest.media', { items: group.length }, () =>
        analyseMedia(chain, request),
      )
      result.calls++
    } catch (e) {
      // Nothing here is urgent: the next sweep tries again (unless the AI is refusing everything).
      deps.log.warn({ err: e instanceof Error ? e.message : String(e) }, 'media analysis failed')
      if (e instanceof AiError && ['billing', 'budget', 'disabled', 'auth'].includes(e.kind)) break
      continue
    }
    const rowsToStore = analyses.flatMap((a) => {
      const item = group[Number(a.itemId)]
      const domain = item && (item.publisherDomain ?? extractDomain(item.url))
      if (!item || !domain) return []
      return [
        {
          url: item.url,
          domain,
          title: titleOf(item.text, item.title),
          sourceId: item.sourceId,
          publishedAt: item.publishedAt,
          aboutMovement: a.aboutMovement,
          mentionsDemands: a.mentionsDemands,
          demands: a.demands,
          voices: a.voices,
          focus: a.focus,
          incidents: a.incidents,
          policeViolence: a.policeViolence,
          terms: a.terms,
          tone: a.tone,
          quoteDemands: a.quoteDemands,
          quoteFraming: a.quoteFraming,
          model: [...chain.served].at(-1) ?? null,
          promptVersion: 'v1',
          textChars: item.text.length,
        },
      ]
    })
    if (rowsToStore.length > 0)
      await db.insert(schema.mediaAnalyses).values(rowsToStore).onConflictDoNothing()
    result.analysed += rowsToStore.length
  }
  await deps.events.emit({ stage: 'media', outcome: 'ok', detail: { ...result } })
  await deps.aiUsage.flush()
  if (result.more && result.analysed > 0) await deps.trigger('media')
  return result
}
