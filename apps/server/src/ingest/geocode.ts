/**
 * Places of a route to coordinates. A wrong point is worse than a missing one (it draws a march
 * where there is none), so a place is "ok" only when it is in the right commune AND its distinctive
 * words are in what the geocoder answered. The address base (BAN) is good at streets and bad at
 * places of interest (stations, prefectures, campuses): those fall back to OpenStreetMap inside a
 * box around the commune, and otherwise stay "weak" (a guess for a person to confirm) or "none".
 * Measured on 141 places: see docs/measurements/route-measurement.md.
 */
import type { schema } from '@manifeste/db'

type ProposalPlace = (typeof schema.routeProposals.$inferInsert)['places'][number]
import type { FetchLike } from './types.ts'

export interface Commune {
  name: string
  code: string
  lng: number
  lat: number
}

const BAN = 'https://api-adresse.data.gouv.fr/search/'
const GEO = 'https://geo.api.gouv.fr/communes'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** Words that name a kind of place or a link, not the place: they cannot prove a match. */
const GENERIC = new Set(
  (
    'de du des la le les l d et en au aux sur sous a ' +
    'rue place boulevard bd avenue av quai pont cours esplanade chemin route allee impasse square ' +
    'parvis rond point gare prefecture mairie hotel ville universite fac campus lycee college ' +
    'rectorat palais jardin parc centre'
  ).split(' '),
)

export const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Same commune name, whatever the case, accents, hyphens and "St"/"Saint". */
export const sameName = (a: string, b: string): boolean => {
  const plain = (s: string) =>
    fold(s)
      .replace(/\bste\b/g, 'sainte')
      .replace(/\bst\b/g, 'saint')
  return plain(a) === plain(b)
}

/** The words of a place name that tell it apart from every other of its kind. */
export const distinctive = (name: string): string[] =>
  fold(name)
    .split(' ')
    .filter((w) => w.length > 1 && !GENERIC.has(w))

/** Share of the distinctive words of `name` found in `answer`; 0 when the name has none. */
export function coverage(name: string, answer: string): number {
  const words = distinctive(name)
  if (words.length === 0) return 0
  const haystack = ` ${fold(answer)} `
  return words.filter((w) => haystack.includes(` ${w} `)).length / words.length
}

const km = (a: [number, number], b: [number, number]): number => {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
export const distanceKm = km

/** A point farther than this from the commune centre is not in the march of that commune. */
const MAX_FROM_CENTRE_KM = 7

interface BanFeature {
  geometry: { coordinates: [number, number] }
  properties: { label: string; name?: string; score: number; type: string; citycode: string }
}

export class Geocoder {
  private communes = new Map<string, Promise<Commune | null>>()
  private places = new Map<string, Promise<ProposalPlace>>()
  private lastNominatim = 0

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly opts: {
      sleep?: (ms: number) => Promise<void>
      now?: () => number
      userAgent?: string
    } = {},
  ) {}

  private async json<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
    try {
      const res = await this.fetchFn(url, {
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(8_000),
      })
      return res.ok ? ((await res.json()) as T) : null
    } catch {
      return null
    }
  }

  commune(name: string): Promise<Commune | null> {
    const key = fold(name)
    let found = this.communes.get(key)
    if (!found) {
      found = this.json<
        Array<{ nom: string; code: string; centre?: { coordinates: [number, number] } }>
      >(
        `${GEO}?nom=${encodeURIComponent(name)}&fields=nom,code,centre&boost=population&limit=5`,
      ).then((rows) => {
        // The name must be the commune's own: a search for "Tournai" or "Liège" (Belgian towns)
        // also returns "Tournai-sur-Dive" and "Le Liège", which are not the place meant.
        const c = (Array.isArray(rows) ? rows : []).find((r) => sameName(r.nom, name))
        return c?.centre
          ? {
              name: c.nom,
              code: c.code,
              lng: c.centre.coordinates[0],
              lat: c.centre.coordinates[1],
            }
          : null
      })
      this.communes.set(key, found)
    }
    return found
  }

  place(name: string, commune: Commune): Promise<ProposalPlace> {
    const key = `${commune.code}|${fold(name)}`
    let found = this.places.get(key)
    if (!found) {
      found = this.resolve(name, commune)
      this.places.set(key, found)
    }
    return found
  }

  private async resolve(name: string, commune: Commune): Promise<ProposalPlace> {
    const base = { name, quote: '' }
    const centre: [number, number] = [commune.lng, commune.lat]
    const ban = await this.json<{ features: BanFeature[] }>(
      `${BAN}?q=${encodeURIComponent(`${name} ${commune.name}`)}&citycode=${commune.code}&limit=3`,
    )
    let guess: ProposalPlace | null = null
    for (const f of Array.isArray(ban?.features) ? ban.features : []) {
      const [lng, lat] = f.geometry.coordinates
      if (f.properties.citycode !== commune.code) continue
      if (km(centre, [lng, lat]) > MAX_FROM_CENTRE_KM) continue
      const cover = coverage(name, `${f.properties.label} ${f.properties.name ?? ''}`)
      const point = { ...base, lng, lat, label: f.properties.label }
      if (cover >= 0.99 && f.properties.score >= 0.5) return { ...point, status: 'ok' }
      guess ??= { ...point, status: 'weak' }
    }
    // Places of interest: OpenStreetMap, only inside a box around the commune.
    const osm = await this.nominatim(name, commune)
    if (osm) return osm
    return guess ?? { ...base, lng: null, lat: null, label: null, status: 'none' }
  }

  private async nominatim(name: string, commune: Commune): Promise<ProposalPlace | null> {
    const wait = Math.max(0, this.lastNominatim + 1_100 - (this.opts.now?.() ?? Date.now()))
    if (wait > 0) await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait)
    this.lastNominatim = this.opts.now?.() ?? Date.now()
    const d = 0.07
    const box = [commune.lng - d, commune.lat + d, commune.lng + d, commune.lat - d].join(',')
    const rows = await this.json<Array<{ lat: string; lon: string; display_name: string }>>(
      `${NOMINATIM}?q=${encodeURIComponent(name)}&format=json&limit=3&countrycodes=fr&viewbox=${box}&bounded=1`,
      { 'user-agent': this.opts.userAgent ?? 'manifeste-route-detection (open source)' },
    )
    for (const r of Array.isArray(rows) ? rows : []) {
      const lng = Number(r.lon)
      const lat = Number(r.lat)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      if (km([commune.lng, commune.lat], [lng, lat]) > MAX_FROM_CENTRE_KM) continue
      if (coverage(name, r.display_name) < 0.99) continue
      return {
        name,
        quote: '',
        lng,
        lat,
        label: `OSM : ${r.display_name.slice(0, 120)}`,
        status: 'ok',
      }
    }
    return null
  }
}
