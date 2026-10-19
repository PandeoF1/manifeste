/**
 * Movements: a dated campaign (e.g. "Lycéens, automne 2026") that groups events. Pure code, no I/O.
 * An event is a march, a rally or a blockade; a march may carry a route drawn on the map.
 * The school reports (blockades) are a separate, older model and are not part of this.
 */

/** An archived movement keeps its page, map and data; only its end date is set. */
export const MOVEMENT_STATUSES = ['active', 'archived'] as const
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number]

/**
 * `signaled`: a "mobilisation signalée", a demonstration the press reports, placed by the place it
 * names (a point or a zone) and with no route; it follows no movement unless a person attaches it.
 */
export const EVENT_KINDS = ['march', 'rally', 'blockade', 'signaled'] as const
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

/** How precisely a signaled mobilisation is placed. */
export const ZONE_PRECISIONS = ['point', 'district', 'city'] as const
export type ZonePrecision = (typeof ZONE_PRECISIONS)[number]

/** A GeoJSON polygon, [lng, lat] pairs: the red area drawn for a district or a whole commune. */
export interface Zone {
  type: 'Polygon'
  coordinates: Array<Array<[number, number]>>
}

/** Most points a drawn zone may have: a map and an API response must stay light. */
export const MAX_ZONE_POINTS = 400

/** A valid zone, or null: one closed ring at least, in range, within the point cap. */
export function parseZone(raw: unknown): Zone | null {
  const z = raw as { type?: unknown; coordinates?: unknown } | null
  if (!z || z.type !== 'Polygon' || !Array.isArray(z.coordinates) || z.coordinates.length === 0)
    return null
  let total = 0
  for (const ring of z.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4) return null
    total += ring.length
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) return null
      const [lng, lat] = p as number[]
      if (typeof lng !== 'number' || typeof lat !== 'number') return null
      if (!(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90)) return null
    }
  }
  return total <= MAX_ZONE_POINTS ? (raw as Zone) : null
}

/** A circle of `radiusM` metres around a point, as a zone (for a district known only by its centre). */
export function circleZone(lng: number, lat: number, radiusM: number, steps = 24): Zone {
  const ring: Array<[number, number]> = []
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps
    ring.push([+(lng + dLng * Math.cos(a)).toFixed(6), +(lat + dLat * Math.sin(a)).toFixed(6)])
  }
  ring.push(ring[0] as [number, number])
  return { type: 'Polygon', coordinates: [ring] }
}

/** Douglas-Peucker on an open polyline; `tolerance` in degrees. */
function simplifyLine(pts: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (pts.length < 3) return pts
  const first = pts[0] as [number, number]
  const last = pts[pts.length - 1] as [number, number]
  let index = 0
  let max = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i] as [number, number]
    const dx = last[0] - first[0]
    const dy = last[1] - first[1]
    const len = dx * dx + dy * dy
    const t =
      len === 0
        ? 0
        : Math.max(0, Math.min(1, ((p[0] - first[0]) * dx + (p[1] - first[1]) * dy) / len))
    const d = Math.hypot(p[0] - (first[0] + t * dx), p[1] - (first[1] + t * dy))
    if (d > max) {
      max = d
      index = i
    }
  }
  if (max <= tolerance) return [first, last]
  return [
    ...simplifyLine(pts.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyLine(pts.slice(index), tolerance),
  ]
}

/**
 * The outer ring of a GeoJSON Polygon or MultiPolygon (the largest one), simplified until it fits
 * the point cap, as a zone. Holes are dropped: a district is drawn full.
 */
export function zoneFromGeometry(geometry: unknown): Zone | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (!g || !g.coordinates) return null
  const polygons: number[][][][] =
    g.type === 'Polygon'
      ? [g.coordinates as number[][][]]
      : g.type === 'MultiPolygon'
        ? (g.coordinates as number[][][][])
        : []
  const outers = polygons.flatMap((p) => (Array.isArray(p?.[0]) ? [p[0] as number[][]] : []))
  if (outers.length === 0) return null
  const area = (ring: number[][]) => {
    let a = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i] as number[]
      const q = ring[i + 1] as number[]
      a += (p[0] as number) * (q[1] as number) - (q[0] as number) * (p[1] as number)
    }
    return Math.abs(a / 2)
  }
  const biggest = outers.reduce((a, b) => (area(b) > area(a) ? b : a))
  let ring = biggest.map(([x, y]) => [x as number, y as number] as [number, number])
  for (let tol = 0.0002; ring.length > MAX_ZONE_POINTS - 1 && tol < 0.05; tol *= 1.6)
    ring = simplifyLine(ring, tol)
  if (ring.length < 4) return null
  const closed =
    ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1]
      ? ring
      : [...ring, ring[0] as [number, number]]
  return parseZone({ type: 'Polygon', coordinates: [closed] })
}
