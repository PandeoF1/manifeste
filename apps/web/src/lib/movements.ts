import {
  eventStatusAt,
  parseRoute,
  routeLengthMeters,
  type EventKind,
  type EventStatus,
  type RouteBasis,
} from '@manifeste/core'
import type { FeatureCollection, LineString, Point } from 'geojson'

/** The fields of an event the page and the map use (a subset of what the API returns). */
export interface MovementEvent {
  id: string
  kind: EventKind
  title: string
  place: string | null
  status: EventStatus
  startsAt: Date
  endsAt: Date | null
  lat: number | null
  lng: number | null
  route: Array<[number, number]> | null
  routeBasis: RouteBasis | null
  sourceUrl: string | null
  sourceDomain: string | null
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  march: 'Cortège',
  rally: 'Rassemblement',
  blockade: 'Blocage',
}

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  planned: 'À venir',
  ongoing: 'En cours',
  ended: 'Terminé',
  cancelled: 'Annulé',
}

/** What a drawn route is worth: the map and the list always say it. */
export const ROUTE_BASIS_LABEL: Record<RouteBasis, string> = {
  announced: 'Parcours annoncé',
  probable: 'Parcours probable (calculé, à vérifier)',
}

/** Same hues as the school map: red for what is happening, amber for what is coming. */
export const EVENT_STATUS_COLOR: Record<EventStatus, string> = {
  ongoing: '#ff453a',
  planned: '#ff9f0a',
  ended: '#98a2b3',
  cancelled: '#98a2b3',
}

/** The status to show at `now`: the dates decide, except for cancelled and ended. */
export const shownStatus = (e: MovementEvent, now: Date): EventStatus => eventStatusAt(e, now)

export interface RouteProps {
  id: string
  status: EventStatus
  basis: RouteBasis
}

/** One line per event that has a route. The status is the one shown at `now`. */
export function routesGeoJSON(
  events: ReadonlyArray<MovementEvent>,
  now: Date,
): FeatureCollection<LineString, RouteProps> {
  return {
    type: 'FeatureCollection',
    features: events.flatMap((e) =>
      e.route && e.route.length >= 2 && e.routeBasis
        ? [
            {
              type: 'Feature' as const,
              id: e.id,
              properties: { id: e.id, status: shownStatus(e, now), basis: e.routeBasis },
              geometry: { type: 'LineString' as const, coordinates: e.route },
            },
          ]
        : [],
    ),
  }
}

export interface PointProps {
  id: string
  status: EventStatus
  kind: EventKind
}

/** Where an event gathers: its own position, else the start of its route. */
export function startOf(e: MovementEvent): [number, number] | null {
  if (e.lat !== null && e.lng !== null) return [e.lng, e.lat]
  return e.route?.[0] ?? null
}

export function pointsGeoJSON(
  events: ReadonlyArray<MovementEvent>,
  now: Date,
): FeatureCollection<Point, PointProps> {
  return {
    type: 'FeatureCollection',
    features: events.flatMap((e) => {
      const at = startOf(e)
      return at
        ? [
            {
              type: 'Feature' as const,
              id: e.id,
              properties: { id: e.id, status: shownStatus(e, now), kind: e.kind },
              geometry: { type: 'Point' as const, coordinates: at },
            },
          ]
        : []
    }),
  }
}

/** [west, south, east, north] around the given events (their routes and positions), or null. */
export function boundsOf(
  events: ReadonlyArray<MovementEvent>,
): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null
  const add = ([lng, lat]: readonly [number, number]) => {
    box = box
      ? [Math.min(box[0], lng), Math.min(box[1], lat), Math.max(box[2], lng), Math.max(box[3], lat)]
      : [lng, lat, lng, lat]
  }
  for (const e of events) {
    const at = startOf(e)
    if (at) add(at)
    for (const p of e.route ?? []) add(p)
  }
  return box
}

/** "3,2 km", or null when there is no route. */
export function routeLengthLabel(e: MovementEvent): string | null {
  if (!e.route || e.route.length < 2) return null
  const m = routeLengthMeters(e.route)
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

/** Day groups of the event list, in the order of the events (oldest first). */
export function groupByDay<T extends { startsAt: Date }>(
  events: ReadonlyArray<T>,
  dayOf: (d: Date) => string,
): Array<{ day: string; events: T[] }> {
  const groups: Array<{ day: string; events: T[] }> = []
  for (const e of events) {
    const day = dayOf(e.startsAt)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.events.push(e)
    else groups.push({ day, events: [e] })
  }
  return groups
}

export type RouteText =
  { ok: true; route: Array<[number, number]> | null } | { ok: false; error: string }

/**
 * A route typed or pasted by staff. Two forms: one "latitude, longitude" pair per line (the order
 * Google Maps shows when you copy a point), or a GeoJSON list [[longitude, latitude], ...].
 * Empty means no route. Anything doubtful is refused rather than guessed.
 */
export function parseRouteText(text: string): RouteText {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, route: null }
  let points: unknown
  if (trimmed.startsWith('[')) {
    try {
      points = JSON.parse(trimmed)
    } catch {
      return { ok: false, error: 'Liste JSON illisible.' }
    }
  } else {
    const pairs: Array<[number, number]> = []
    for (const [i, line] of trimmed.split(/\r?\n/).entries()) {
      if (!line.trim()) continue
      const parts = line.trim().split(/[\s,;]+/)
      const [lat, lng] = parts.map(Number)
      if (parts.length !== 2 || lat === undefined || lng === undefined)
        return { ok: false, error: `Ligne ${i + 1} : écris « latitude, longitude ».` }
      // Stored in GeoJSON order, [longitude, latitude].
      pairs.push([lng, lat])
    }
    points = pairs
  }
  const route = parseRoute(points)
  if (!route)
    return {
      ok: false,
      error:
        'Parcours invalide : au moins 2 points, latitude entre -90 et 90, longitude entre -180 et 180.',
    }
  return { ok: true, route: route.map(([lng, lat]) => [lng, lat] as [number, number]) }
}

/** "50.6296, 3.0706" (as copied from a map) to [lng, lat], or null. */
export function parseLatLng(text: string): [number, number] | null {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(text)
  if (!m) return null
  const lat = Number(m[1]?.replace(',', '.'))
  const lng = Number(m[2]?.replace(',', '.'))
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null
}
