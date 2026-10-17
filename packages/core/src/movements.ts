/**
 * Movements: a dated campaign (e.g. "Lycéens, automne 2026") that groups events. Pure code, no I/O.
 * An event is a march, a rally or a blockade; a march may carry a route drawn on the map.
 * The school reports (blockades) are a separate, older model and are not part of this.
 */

/** An archived movement keeps its page, map and data; only its end date is set. */
export const MOVEMENT_STATUSES = ['active', 'archived'] as const
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number]

export const EVENT_KINDS = ['march', 'rally', 'blockade'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

/** `ongoing` and `ended` are also derived from the dates (see eventStatusAt). */
export const EVENT_STATUSES = ['planned', 'ongoing', 'ended', 'cancelled'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/**
 * How reliable a drawn route is. `announced`: given by the organisers or the prefecture.
 * `probable`: computed between the places an article names; it is a hypothesis and the map says so.
 */
export const ROUTE_BASES = ['announced', 'probable'] as const
export type RouteBasis = (typeof ROUTE_BASES)[number]

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** URL-safe identifier from a title: "Lycéens, automne 2026" -> "lyceens-automne-2026". */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

/** GeoJSON order: [longitude, latitude]. */
export type RoutePoint = readonly [lng: number, lat: number]

export const MAX_ROUTE_POINTS = 2000

/**
 * A route as stored: at least two [lng, lat] points inside valid coordinates, no more than
 * MAX_ROUTE_POINTS. Anything else is rejected rather than repaired, so a bad route never
 * reaches the map.
 */
export function parseRoute(value: unknown): RoutePoint[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_ROUTE_POINTS) return null
  const points: RoutePoint[] = []
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2) return null
    const [lng, lat] = p as unknown[]
    if (typeof lng !== 'number' || typeof lat !== 'number') return null
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
    points.push([lng, lat])
  }
  return points
}

/** Length of a route in metres (haversine, summed over the segments). */
export function routeLengthMeters(route: ReadonlyArray<RoutePoint>): number {
  const R = 6_371_000
  const rad = (d: number) => (d * Math.PI) / 180
  let total = 0
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1]
    const to = route[i]
    if (!from || !to) continue
    const [lng1, lat1] = from
    const [lng2, lat2] = to
    const dLat = rad(lat2 - lat1)
    const dLng = rad(lng2 - lng1)
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
  }
  return Math.round(total)
}

/** An event without an end is assumed to last this long once it has started. */
export const DEFAULT_EVENT_HOURS = 4

/**
 * The status to show now. A cancelled event stays cancelled. Otherwise the dates decide: before
 * the start it is planned, between start and end it is ongoing, after the end it is ended.
 * `ended` stored by staff is final even if the dates say otherwise.
 */
export function eventStatusAt(
  event: { status: EventStatus; startsAt: Date; endsAt: Date | null },
  now: Date = new Date(),
): EventStatus {
  if (event.status === 'cancelled' || event.status === 'ended') return event.status
  const end = event.endsAt ?? new Date(event.startsAt.getTime() + DEFAULT_EVENT_HOURS * 3_600_000)
  if (now < event.startsAt) return 'planned'
  if (now < end) return 'ongoing'
  return 'ended'
}
