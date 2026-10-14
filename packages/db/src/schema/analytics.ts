/**
 * First-party, anonymous statistics. No IP, cookie or fingerprint is stored: a visitor is a
 * hash of the IP salted with a secret that is destroyed every night, so yesterday's visitors can
 * never be linked to today's. Only aggregates are kept beyond the day.
 */
import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { analyticsPage, webVital } from './enums.ts'

/** Today's salt (and only today's: older salts are deleted every night). */
export const dailySalts = pgTable('daily_salts', {
  day: date().primaryKey(),
  salt: text().notNull(),
})

/** Today's visitor hashes, to count unique visitors. Rolled up into analytics_daily overnight. */
export const analyticsVisitorsToday = pgTable(
  'analytics_visitors_today',
  {
    day: date().notNull(),
    visitor: text().notNull(),
    firstSeen: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.visitor] })],
)

export const analyticsDaily = pgTable('analytics_daily', {
  day: date().primaryKey(),
  visitors: integer().notNull().default(0),
})

/** Page views per 5-minute slot. */
export const analyticsPageViews = pgTable(
  'analytics_page_views',
  {
    slot: timestamp({ withTimezone: true }).notNull(),
    page: analyticsPage().notNull(),
    views: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.slot, t.page] })],
)

/** New visitors of the day per 5-minute slot (a count only). */
export const analyticsNewVisitors = pgTable(
  'analytics_new_visitors',
  {
    slot: timestamp({ withTimezone: true }).primaryKey(),
    count: integer().notNull(),
  },
  (t) => [check('analytics_new_visitors_positive', sql`${t.count} > 0`)],
)

/** Open tabs right now: one random id per tab, forgotten after 10 minutes. */
export const analyticsLive = pgTable('analytics_live', {
  session: uuid().primaryKey(),
  page: analyticsPage().notNull(),
  seenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

/** Visitors online, one row per minute (kept 14 days). */
export const analyticsOnline = pgTable('analytics_online', {
  minute: timestamp({ withTimezone: true }).primaryKey(),
  online: integer().notNull(),
})

/** Web vitals and API latency measured in visitors' browsers (kept 30 days). */
export const analyticsVitals = pgTable(
  'analytics_vitals',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    page: analyticsPage().notNull(),
    metric: webVital().notNull(),
    value: real().notNull(),
  },
  (t) => [index().on(t.at)],
)

/** On-site reports per visitor hash and day (the daily limit). */
export const submissionLimits = pgTable(
  'submission_limits',
  {
    visitor: text().notNull(),
    day: date().notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.visitor, t.day] })],
)
