import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { user } from './auth.ts'
import { certainty, extractionOutcome, itemState, reportStatus } from './enums.ts'
import { reports } from './reports.ts'
import { schools } from './schools.ts'
import { sources } from './sources.ts'

/**
 * One thing a source published (an article, a post, a map point). The row is the item's place in
 * the pipeline: its `state` says where it rests, and lanes (unreadable, deferred, failed) are just
 * states an admin can retry. It also replaces the old "seen" table: an item that exists was seen.
 */
export const ingestItems = pgTable(
  'ingest_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    /** Stable id inside the source (post id, feed guid, map point). */
    externalId: text().notNull(),
    /** Canonical https URL. */
    url: text().notNull(),
    publishedAt: timestamp({ withTimezone: true }).notNull(),
    /** Publisher domain when it differs from the URL (aggregators such as Google News). */
    publisherDomain: text(),
    geoLat: doublePrecision(),
    geoLng: doublePrecision(),
    /** Sent to the AI without the keyword filter (a point of a map of blockades). */
    alwaysRelevant: boolean().notNull().default(false),
    state: itemState().notNull().default('discovered'),
    /** Why it rests there: the blocked reason, "off topic", the last error. */
    reason: text(),
    attempts: integer().notNull().default(0),
    /** The item this one was merged into (same article from another source). */
    mergedInto: uuid().references((): AnyPgColumn => ingestItems.id, { onDelete: 'set null' }),
    runId: uuid(),
    discoveredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('ingest_items_source_external').on(t.sourceId, t.externalId),
    index('ingest_items_state').on(t.state, t.updatedAt.desc()),
    index('ingest_items_discovered').on(t.discoveredAt.desc()),
  ],
)

/**
 * The text of an item, read from the source or the article page. Press text is copyrighted and
 * only needed while the item is analysed: a job deletes it after 7 days.
 */
export const itemContents = pgTable('item_contents', {
  itemId: uuid()
    .primaryKey()
    .references(() => ingestItems.id, { onDelete: 'cascade' }),
  title: text().notNull().default(''),
  text: text().notNull(),
  chars: integer().notNull(),
  /** How the text was found (json-ld, site-rule, article, feed…), to explain a bad read. */
  strategy: text(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

/** One fact the AI extracted from an item, and what became of it. */
export const extractions = pgTable(
  'extractions',
  {
    id: uuid().primaryKey().defaultRandom(),
    itemId: uuid()
      .notNull()
      .references(() => ingestItems.id, { onDelete: 'cascade' }),
    schoolName: text().notNull(),
    city: text(),
    status: reportStatus().notNull(),
    certainty: certainty().notNull(),
    /** What the model wrote, resolved later against the publication date. */
    observedAtRaw: text(),
    nature: text(),
    provider: text().notNull(),
    model: text().notNull(),
    promptVersion: text().notNull(),
    /** Null until the resolve stage has handled it. */
    outcome: extractionOutcome(),
    outcomeDetail: text(),
    schoolUai: text().references(() => schools.uai),
    reportId: uuid().references(() => reports.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('extractions_item').on(t.itemId),
    index('extractions_unresolved')
      .on(t.createdAt)
      .where(sql`${t.outcome} is null`),
  ],
)

/** Facts about a school the directory could not identify: the staff queue (and the re-match job). */
export const unmatched = pgTable(
  'unmatched',
  {
    id: uuid().primaryKey().defaultRandom(),
    extractionId: uuid().references(() => extractions.id, { onDelete: 'set null' }),
    sourceId: uuid().references(() => sources.id, { onDelete: 'cascade' }),
    sourceDomain: text(),
    /** An excerpt (600 characters) for staff and the re-analysis; deleted after 7 days. */
    context: text(),
    schoolName: text().notNull(),
    city: text(),
    status: reportStatus().notNull(),
    sourceUrl: text().notNull(),
    observedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: text().references(() => user.id, { onDelete: 'set null' }),
    /** linked | dismissed | matched (by the re-match job) */
    resolution: text(),
    linkedUai: text().references(() => schools.uai),
  },
  (t) => [
    index('unmatched_open')
      .on(t.createdAt.desc())
      .where(sql`${t.resolvedAt} is null`),
  ],
)

/**
 * One line per thing that happened in the pipeline: a stage handled an item, a source was read, a
 * job started. Feeds the admin live diagram and the funnel, and ties a result to its trace.
 * Kept 30 days.
 */
export const pipelineEvents = pgTable(
  'pipeline_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** One discovery pass (or one manual job) and everything it set off. */
    runId: uuid(),
    stage: text().notNull(),
    sourceId: uuid(),
    itemId: uuid(),
    /** ok | skipped | deferred | failed, or the specific outcome. */
    outcome: text().notNull(),
    durationMs: integer(),
    detail: jsonb(),
    traceId: text(),
  },
  (t) => [
    index('pipeline_events_at').on(t.at.desc()),
    index('pipeline_events_stage_at').on(t.stage, t.at.desc()),
    index('pipeline_events_item').on(t.itemId),
  ],
)

/** One read of one source: the history behind the source health badge. */
export const sourceRuns = pgTable(
  'source_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    /** schedule | manual */
    trigger: text().notNull().default('schedule'),
    fetched: integer().notNull().default(0),
    newItems: integer().notNull().default(0),
    error: text(),
  },
  (t) => [index('source_runs_source').on(t.sourceId, t.startedAt.desc())],
)
