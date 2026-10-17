import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { eventKind, eventStatus, moderationState, movementStatus, routeBasis } from './enums.ts'

/**
 * A movement: a dated campaign that groups events ("Lycéens, automne 2026"). The home page shows
 * the active one; an archived movement keeps its page, map and data. Independent of the school
 * reports, which stay as they are.
 */
export const movements = pgTable(
  'movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Stable, public address: /mouvements/<slug>. */
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text(),
    status: movementStatus().notNull().default('active'),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    /** Set when the movement is archived. */
    endsAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('movements_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('movements_dates', sql`${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
    index('movements_status_start').on(t.status, t.startsAt.desc()),
  ],
)

/**
 * A march, a rally or a blockade. `movementId` is null for events that follow no movement (the
 * watch). `route` is a GeoJSON coordinate list ([lng, lat] pairs), drawn on the map when present;
 * `routeBasis` says whether it is announced or only probable.
 */
export const movementEvents = pgTable(
  'movement_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    movementId: uuid().references(() => movements.id, { onDelete: 'set null' }),
    kind: eventKind().notNull(),
    title: text().notNull(),
    place: text(),
    status: eventStatus().notNull().default('planned'),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }),
    /** Where it gathers (or the rally point). */
    lat: doublePrecision(),
    lng: doublePrecision(),
    route: jsonb().$type<Array<[number, number]>>(),
    routeBasis: routeBasis(),
    sourceUrl: text(),
    sourceDomain: text(),
    moderation: moderationState().notNull().default('pending'),
    /** Hidden events stay in the database but are never shown. */
    hidden: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('movement_events_route_basis', sql`${t.route} is null or ${t.routeBasis} is not null`),
    check(
      'movement_events_position',
      sql`(${t.lat} is null) = (${t.lng} is null) and (${t.lat} is null or (${t.lat} between -90 and 90 and ${t.lng} between -180 and 180))`,
    ),
    check(
      'movement_events_source_https',
      sql`${t.sourceUrl} is null or ${t.sourceUrl} ~ '^https://'`,
    ),
    check('movement_events_dates', sql`${t.endsAt} is null or ${t.endsAt} >= ${t.startsAt}`),
    index('movement_events_movement_start').on(t.movementId, t.startsAt.desc()),
    index('movement_events_public_start')
      .on(t.startsAt.desc())
      .where(sql`${t.moderation} = 'approved' and not ${t.hidden}`),
  ],
)

/** One place of a proposed route: as the article writes it, then where it was found. */
export interface ProposalPlace {
  name: string
  /** The sentence of the article that backs this place. */
  quote: string
  lng: number | null
  lat: number | null
  /** ok: found and checked; weak: a guess a person must look at; none: not found. */
  status: 'ok' | 'weak' | 'none'
  /** What the geocoder answered, for the person who checks. */
  label: string | null
}

/**
 * A route the detection read in a press article. It is a proposal: nothing shows on the public
 * map until a person approves it, which creates a movement event. `groupKey` (commune + day)
 * gathers the proposals about the same march from several articles.
 */
export const routeProposals = pgTable(
  'route_proposals',
  {
    id: uuid().primaryKey().defaultRandom(),
    url: text().notNull(),
    domain: text().notNull(),
    articleTitle: text(),
    publishedAt: timestamp({ withTimezone: true }),
    city: text().notNull(),
    /** INSEE code of the commune, when the geocoder found it. */
    citycode: text(),
    /** Day of the march (Paris), when the article gives it. */
    day: text(),
    timing: text().notNull(),
    title: text().notNull(),
    places: jsonb().$type<ProposalPlace[]>().notNull(),
    /** Walking route through the places found; null when not computed or not plausible. */
    line: jsonb().$type<Array<[number, number]>>(),
    lineKm: doublePrecision(),
    /** What a person should look at first, in French ("point mal placé", "trajet trop long"…). */
    warnings: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    groupKey: text().notNull(),
    status: text().notNull().default('pending'),
    eventId: uuid().references(() => movementEvents.id, { onDelete: 'set null' }),
    model: text(),
    promptVersion: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('route_proposals_status_created').on(t.status, t.createdAt.desc()),
    index('route_proposals_group').on(t.groupKey),
    check('route_proposals_status', sql`${t.status} in ('pending', 'approved', 'rejected')`),
    check('route_proposals_timing', sql`${t.timing} in ('announced', 'ongoing', 'past')`),
    check('route_proposals_url', sql`${t.url} ~ '^https?://'`),
    // One article can describe several marches (one per city): url + city is the identity.
    uniqueIndex('route_proposals_url_city').on(t.url, t.city),
  ],
)

/**
 * Articles the detection already read, whether or not they held a route: the next sweep skips
 * them (one AI call per article, ever).
 */
export const routeScans = pgTable('route_scans', {
  url: text().primaryKey(),
  scannedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  found: integer().notNull().default(0),
})
