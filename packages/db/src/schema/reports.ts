import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.ts'
import {
  certainty,
  dateBasis,
  judgeLevel,
  judgeNature,
  moderationState,
  reportOrigin,
  reportStatus,
  tier,
} from './enums.ts'
import { schools } from './schools.ts'
import { sources } from './sources.ts'

/**
 * One fact about one school at one moment, with its public source. No article text is stored.
 * `tier` is computed by @manifeste/core (tierOf) whenever the judgement or the thresholds change.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    schoolUai: text()
      .notNull()
      .references(() => schools.uai),
    status: reportStatus().notNull(),
    origin: reportOrigin().notNull(),
    sourceId: uuid().references(() => sources.id, { onDelete: 'set null' }),
    sourceUrl: text(),
    sourceDomain: text(),
    moderation: moderationState().notNull().default('pending'),
    certainty: certainty(),
    /** When the fact happened (see resolveObservation), what the map uses. */
    observedAt: timestamp({ withTimezone: true }).notNull(),
    /** Publication of the source item. */
    publishedAt: timestamp({ withTimezone: true }),
    /** Raw date the AI extracted, kept to explain `observedAt`. */
    extractedObservedAt: text(),
    dateBasis: dateBasis(),
    tier: tier().notNull().default('unjudged'),
    /** Hidden reports stay in the database but are never shown or counted. */
    hidden: boolean().notNull().default(false),
    /** Blurred photo published by staff (blob key). */
    photoKey: text(),
    moderatedAt: timestamp({ withTimezone: true }),
    moderatedBy: text().references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      'reports_source_required',
      sql`${t.origin} = 'on_site' or (${t.sourceUrl} is not null and ${t.sourceDomain} is not null)`,
    ),
    check('reports_source_url_https', sql`${t.sourceUrl} ~ '^https://'`),
    check(
      'reports_source_domain_format',
      sql`${t.sourceDomain} is null or (${t.sourceDomain} <> '' and ${t.sourceDomain} = lower(${t.sourceDomain}))`,
    ),
    index('reports_school_observed').on(t.schoolUai, t.observedAt.desc()),
    index('reports_public_observed')
      .on(t.observedAt.desc())
      .where(sql`${t.moderation} = 'approved' and not ${t.hidden}`),
    index('reports_pending')
      .on(t.createdAt)
      .where(sql`${t.moderation} = 'pending'`),
    index('reports_source').on(t.sourceId),
    // The same article cannot report the same status for a school twice (re-collected, merged).
    uniqueIndex('reports_collected_unique')
      .on(t.schoolUai, t.sourceUrl, t.status)
      .where(sql`${t.origin} <> 'on_site' and ${t.sourceUrl} is not null`),
  ],
)

/** The judge's latest second opinion on a press or collected report. */
export const judgements = pgTable(
  'judgements',
  {
    reportId: uuid()
      .primaryKey()
      .references(() => reports.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    model: text().notNull(),
    /** Probability that the reported fact is true. */
    probability: real(),
    nature: judgeNature(),
    level: judgeLevel(),
    natureProbabilities: jsonb().$type<Record<string, number>>(),
    levelProbabilities: jsonb().$type<Record<string, number>>(),
    /** Characters of article text the judge read. */
    chars: integer(),
    promptRef: text(),
    judgedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'judgements_probability_range',
      sql`${t.probability} is null or ${t.probability} between 0 and 1`,
    ),
  ],
)

/**
 * Details of an on-site report, readable by staff only. The position is rounded on the device
 * (~100 m); the original photo is deleted once staff decide, or after 48 h.
 */
export const reportSubmissions = pgTable(
  'report_submissions',
  {
    reportId: uuid()
      .primaryKey()
      .references(() => reports.id, { onDelete: 'cascade' }),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    distanceM: integer().notNull(),
    /** Private original photo (blob key) until staff decide. */
    photoKey: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('report_submissions_lat', sql`${t.lat} between -90 and 90`),
    check('report_submissions_lng', sql`${t.lng} between -180 and 180`),
    check('report_submissions_distance', sql`${t.distanceM} >= 0`),
  ],
)

/** An on-site report for a school missing from the directory, checked by staff. */
export const schoolProposals = pgTable(
  'school_proposals',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    city: text().notNull(),
    status: reportStatus().notNull(),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    photoKey: text(),
    sourceUrl: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('school_proposals_name', sql`char_length(${t.name}) between 3 and 120`),
    check('school_proposals_city', sql`char_length(${t.city}) between 1 and 80`),
    check('school_proposals_lat', sql`${t.lat} between -90 and 90`),
    check('school_proposals_lng', sql`${t.lng} between -180 and 180`),
  ],
)
