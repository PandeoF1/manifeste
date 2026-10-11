import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { reportOrigin, sourceHealth, sourceKind } from './enums.ts'

/** Collected sources (Telegram channels, feeds, Bluesky accounts, collaborative maps). */
export const sources = pgTable(
  'sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: sourceKind().notNull(),
    /** Normalised: channel name, feed URL, handle, map id. */
    identifier: text().notNull(),
    label: text().notNull(),
    origin: reportOrigin().notNull().default('aggregator'),
    /** Reports from a trusted source are published without moderation. */
    trusted: boolean().notNull().default(false),
    enabled: boolean().notNull().default(true),
    /** Reports of this source are kept but not shown (a source that misled). */
    reportsHidden: boolean().notNull().default(false),
    /** Adapter-specific options. */
    config: jsonb().notNull().default({}),
    health: sourceHealth().notNull().default('closed'),
    consecutiveFailures: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
    lastRunAt: timestamp({ withTimezone: true }),
    lastSuccessAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique().on(t.kind, t.identifier),
    check('sources_origin_collected', sql`${t.origin} <> 'on_site'`),
  ],
)

/** Press and union domains whose articles are published without moderation (subdomains included). */
export const trustedDomains = pgTable(
  'trusted_domains',
  {
    domain: text().primaryKey(),
    label: text().notNull(),
    origin: reportOrigin().notNull(),
  },
  (t) => [
    check(
      'trusted_domains_format',
      sql`${t.domain} = lower(${t.domain}) and ${t.domain} !~ '^www\\.'`,
    ),
    check('trusted_domains_origin', sql`${t.origin} in ('press', 'union')`),
  ],
)
