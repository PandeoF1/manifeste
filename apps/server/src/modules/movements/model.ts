import { t } from 'elysia'
import {
  EVENT_KINDS,
  EVENT_STATUSES,
  MAX_ROUTE_POINTS,
  MOVEMENT_STATUSES,
  PERIODS,
  ROUTE_BASES,
  SLUG_PATTERN,
} from '@manifeste/core'

/**
 * A union of literals, not t.UnionEnum: UnionEnum makes its first value the default, so an optional
 * field left out of a request would silently take it (a "probable" route stored as "announced", a
 * cancelled event put back to "planned" by an edit of its title).
 */
const oneOf = <const V extends readonly string[]>(values: V) =>
  t.Unsafe<V[number]>(t.Union(values.map((v) => t.Literal(v))))

const kind = oneOf(EVENT_KINDS)
const eventStatus = oneOf(EVENT_STATUSES)
const routeBasis = oneOf(ROUTE_BASES)
const movementStatus = oneOf(MOVEMENT_STATUSES)
/** GeoJSON order, [lng, lat]. The service checks the ranges (parseRoute). */
const route = t.Array(t.Tuple([t.Number(), t.Number()]), {
  minItems: 2,
  maxItems: MAX_ROUTE_POINTS,
})

const period = oneOf(PERIODS)

export const MovementsModel = {
  period,
  movement: t.Object({
    id: t.String(),
    slug: t.String(),
    name: t.String(),
    description: t.Nullable(t.String()),
    status: movementStatus,
    startsAt: t.Date(),
    endsAt: t.Nullable(t.Date()),
    /** Published events only. */
    eventCount: t.Integer(),
  }),
  event: t.Object({
    id: t.String(),
    kind,
    title: t.String(),
    place: t.Nullable(t.String()),
    /** As stored; the page derives planned / ongoing / ended from the dates (eventStatusAt). */
    status: eventStatus,
    startsAt: t.Date(),
    endsAt: t.Nullable(t.Date()),
    lat: t.Nullable(t.Number()),
    lng: t.Nullable(t.Number()),
    route: t.Nullable(route),
    routeBasis: t.Nullable(routeBasis),
    sourceUrl: t.Nullable(t.String()),
    sourceDomain: t.Nullable(t.String()),
  }),
  /** What staff see: also the hidden ones. */
  staffEvent: t.Object({
    id: t.String(),
    kind,
    title: t.String(),
    place: t.Nullable(t.String()),
    status: eventStatus,
    startsAt: t.Date(),
    endsAt: t.Nullable(t.Date()),
    lat: t.Nullable(t.Number()),
    lng: t.Nullable(t.Number()),
    route: t.Nullable(route),
    routeBasis: t.Nullable(routeBasis),
    sourceUrl: t.Nullable(t.String()),
    sourceDomain: t.Nullable(t.String()),
    hidden: t.Boolean(),
  }),
  slugParams: t.Object({ slug: t.String({ pattern: SLUG_PATTERN.source, maxLength: 80 }) }),
  idParams: t.Object({ id: t.String({ format: 'uuid' }) }),
  createMovement: t.Object({
    name: t.String({ minLength: 3, maxLength: 120 }),
    /** Defaults to the slug of the name. */
    slug: t.Optional(t.String({ pattern: SLUG_PATTERN.source, maxLength: 80 })),
    description: t.Optional(t.String({ maxLength: 2000 })),
    startsAt: t.Date(),
  }),
  patchMovement: t.Object({
    name: t.Optional(t.String({ minLength: 3, maxLength: 120 })),
    description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
    status: t.Optional(movementStatus),
    startsAt: t.Optional(t.Date()),
    endsAt: t.Optional(t.Nullable(t.Date())),
  }),
  createEvent: t.Object({
    kind,
    title: t.String({ minLength: 3, maxLength: 160 }),
    place: t.Optional(t.String({ maxLength: 200 })),
    status: t.Optional(eventStatus),
    startsAt: t.Date(),
    endsAt: t.Optional(t.Date()),
    lat: t.Optional(t.Number({ minimum: -90, maximum: 90 })),
    lng: t.Optional(t.Number({ minimum: -180, maximum: 180 })),
    route: t.Optional(route),
    routeBasis: t.Optional(routeBasis),
    sourceUrl: t.Optional(t.String({ maxLength: 2000 })),
  }),
  patchEvent: t.Object({
    title: t.Optional(t.String({ minLength: 3, maxLength: 160 })),
    place: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
    status: t.Optional(eventStatus),
    startsAt: t.Optional(t.Date()),
    endsAt: t.Optional(t.Nullable(t.Date())),
    route: t.Optional(t.Nullable(route)),
    routeBasis: t.Optional(t.Nullable(routeBasis)),
    hidden: t.Optional(t.Boolean()),
  }),
} as const

export type MovementView = typeof MovementsModel.movement.static
export type EventView = typeof MovementsModel.event.static
export type StaffEventView = typeof MovementsModel.staffEvent.static
