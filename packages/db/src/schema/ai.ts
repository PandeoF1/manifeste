import { index, integer, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * What the AI calls consumed, summed per hour, task, provider, model and prompt version. Feeds
 * the admin cost and token charts and the daily spending cap. One row per bucket, upserted by the
 * process that made the calls; individual calls live in traces, not here.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    hour: timestamp({ withTimezone: true }).notNull(),
    /** extract | judge | reanalyse | media (see @manifeste/ai AI_TASKS). */
    task: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    promptVersion: text().notNull(),
    calls: integer().notNull().default(0),
    /** Calls that failed or returned unusable output. Included in `calls`. */
    failures: integer().notNull().default(0),
    promptTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    thoughtsTokens: integer().notNull().default(0),
    /** Estimated from list prices, never a bill. */
    costUsd: numeric({ precision: 12, scale: 6 }).notNull().default('0'),
    latencyMsTotal: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.hour, t.task, t.provider, t.model, t.promptVersion] }),
    index().on(t.hour.desc()),
  ],
)
