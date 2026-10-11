import { schema, type Database } from '@manifeste/db'
import { sql } from 'drizzle-orm'
import type { UsageRow } from '@manifeste/ai'
import { rows } from '../../lib/sql.ts'

export interface DailyUsage {
  day: string
  task: string
  provider: string
  model: string
  calls: number
  failures: number
  promptTokens: number
  outputTokens: number
  thoughtsTokens: number
  costUsd: number
  avgLatencyMs: number
}

/** Persists what the AI consumed and answers "how much have we spent today". */
export class AiUsageService {
  private cached: { at: number; usd: number } | null = null

  constructor(
    private readonly db: Database,
    /** Spend not yet flushed, in memory. */
    private readonly unflushedUsd: () => number,
    private readonly drain: () => UsageRow[],
  ) {}

  /** Writes the in-memory counters to the hourly buckets. Never throws: a lost counter beats a broken run. */
  async flush(): Promise<number> {
    const batch = this.drain()
    if (batch.length === 0) return 0
    try {
      await this.db
        .insert(schema.aiUsage)
        .values(
          batch.map((r) => ({
            hour: sql`date_trunc('hour', now())`,
            task: r.task,
            provider: r.provider,
            model: r.model,
            promptVersion: r.promptVersion,
            calls: r.calls,
            failures: r.failures,
            promptTokens: r.promptTokens,
            outputTokens: r.outputTokens,
            thoughtsTokens: r.thoughtsTokens,
            costUsd: r.costUsd.toFixed(6),
            latencyMsTotal: Math.round(r.latencyMsTotal),
          })),
        )
        .onConflictDoUpdate({
          target: [
            schema.aiUsage.hour,
            schema.aiUsage.task,
            schema.aiUsage.provider,
            schema.aiUsage.model,
            schema.aiUsage.promptVersion,
          ],
          set: {
            calls: sql`${schema.aiUsage.calls} + excluded.calls`,
            failures: sql`${schema.aiUsage.failures} + excluded.failures`,
            promptTokens: sql`${schema.aiUsage.promptTokens} + excluded.prompt_tokens`,
            outputTokens: sql`${schema.aiUsage.outputTokens} + excluded.output_tokens`,
            thoughtsTokens: sql`${schema.aiUsage.thoughtsTokens} + excluded.thoughts_tokens`,
            costUsd: sql`${schema.aiUsage.costUsd} + excluded.cost_usd`,
            latencyMsTotal: sql`${schema.aiUsage.latencyMsTotal} + excluded.latency_ms_total`,
          },
        })
    } catch (e) {
      console.error('ai usage flush failed', e instanceof Error ? e.message : e)
    }
    await this.spentToday(true).catch(() => 0)
    return batch.length
  }

  /** Estimated USD spent today (UTC): stored buckets plus what is still in memory. */
  async spentToday(force = false): Promise<number> {
    const now = Date.now()
    if (force || !this.cached || now - this.cached.at > 10_000) {
      const [row] = await rows<{ usd: string }>(
        this.db,
        sql`select coalesce(sum(cost_usd), 0)::text as usd from ai_usage where hour >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      )
      this.cached = { at: now, usd: Number(row?.usd ?? 0) }
    }
    return this.cached.usd + this.unflushedUsd()
  }

  /** Last known spend without a query, for the synchronous budget guard. */
  spentTodayCached(): number {
    return (this.cached?.usd ?? 0) + this.unflushedUsd()
  }

  async usage(days: number): Promise<DailyUsage[]> {
    const result = await rows<{
      day: string
      task: string
      provider: string
      model: string
      calls: string
      failures: string
      prompt_tokens: string
      output_tokens: string
      thoughts_tokens: string
      cost_usd: string
      latency: string
    }>(
      this.db,
      sql`select (hour at time zone 'utc')::date::text as day, task, provider, model,
            sum(calls)::text as calls, sum(failures)::text as failures,
            sum(prompt_tokens)::text as prompt_tokens, sum(output_tokens)::text as output_tokens,
            sum(thoughts_tokens)::text as thoughts_tokens, sum(cost_usd)::text as cost_usd,
            (sum(latency_ms_total)::float / nullif(sum(calls), 0))::text as latency
          from ai_usage
          where hour >= now() - make_interval(days => ${days})
          group by 1, task, provider, model
          order by 1 desc, task, model`,
    )
    return result.map((r) => ({
      day: r.day,
      task: r.task,
      provider: r.provider,
      model: r.model,
      calls: Number(r.calls),
      failures: Number(r.failures),
      promptTokens: Number(r.prompt_tokens),
      outputTokens: Number(r.output_tokens),
      thoughtsTokens: Number(r.thoughts_tokens),
      costUsd: Number(r.cost_usd),
      avgLatencyMs: Math.round(Number(r.latency ?? 0)),
    }))
  }
}
