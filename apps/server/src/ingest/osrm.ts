/**
 * Walking route through ordered points, from a public OSRM server. A line is returned only when
 * the server found one: a straight line between two points would pass for a real route, so there
 * is no fallback. Plausibility (length, detour) is judged by the caller from the result.
 */
import type { FetchLike } from './types.ts'
import { distanceKm } from './geocode.ts'

export const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/'

export interface WalkingRoute {
  line: Array<[number, number]>
  km: number
  /** Route length over the sum of straight legs: 1 = straight, high = the geocoding is suspect. */
  detour: number
}

/** A march shorter or longer than this is not a march of one commune. */
export const MIN_KM = 0.2
export const MAX_KM = 15
export const MAX_DETOUR = 3.5

export async function walkingRoute(
  fetchFn: FetchLike,
  points: ReadonlyArray<[number, number]>,
  baseUrl = OSRM_FOOT,
): Promise<WalkingRoute | null> {
  if (points.length < 2) return null
  const path = points.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
  try {
    const res = await fetchFn(`${baseUrl}${path}?overview=full&geometries=geojson`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      code?: string
      routes?: Array<{ distance: number; geometry: { coordinates: Array<[number, number]> } }>
    }
    const r = body.routes?.[0]
    if (body.code !== 'Ok' || !r || r.geometry.coordinates.length < 2) return null
    let straight = 0
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (a && b) straight += distanceKm(a, b)
    }
    const km = r.distance / 1000
    return {
      line: r.geometry.coordinates.map(([lng, lat]) => [lng, lat] as [number, number]),
      km,
      detour: straight > 0 ? km / straight : Infinity,
    }
  } catch {
    return null
  }
}

/** French warnings for a route a person is about to look at; empty when it looks right. */
export function routeWarnings(route: WalkingRoute | null, allFound: boolean): string[] {
  if (!allFound) return []
  if (!route) return ['Le trajet à pied n’a pas pu être calculé']
  const out: string[] = []
  if (route.km < MIN_KM) out.push(`Trajet très court (${route.km.toFixed(2)} km)`)
  if (route.km > MAX_KM)
    out.push(`Trajet très long (${route.km.toFixed(1)} km) : un point est peut-être mal placé`)
  if (route.detour > MAX_DETOUR)
    out.push(
      'Trajet très tortueux par rapport à la ligne droite : un point est peut-être mal placé',
    )
  return out
}
