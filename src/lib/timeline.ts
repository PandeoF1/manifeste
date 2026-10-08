import { z } from 'zod'
import { REPORT_STATUSES, type ReportStatus } from '@shared/status.ts'
import { periodSince, type PublicSettings } from './periods'
import type { SchoolStatus } from '@/queries/statuses'

/**
 * Historique de la carte : tous les signalements validés depuis le début du mouvement, pour
 * rejouer la carte à n'importe quel instant (frise en bas de la carte). Les données viennent de
 * la fonction SQL timeline_events ; tout le reste (état à l'instant T, histogramme) est calculé
 * ici, dans le navigateur, sans nouvel appel pendant qu'on avance dans le temps.
 */

const schoolSchema = z.object({
  uai: z.string(),
  name: z.string(),
  city: z.string(),
  department: z.string().nullable(),
  academy: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  level: z.enum(['lycee', 'superieur']),
})
const eventSchema = z.object({
  /** UAI de l'établissement. */
  u: z.string(),
  /** Statut. */
  s: z.enum(REPORT_STATUSES),
  /** Heure du fait, en millisecondes depuis 1970. */
  t: z.number(),
  /** Clé de source (une source compte pour une, quel que soit le nombre d'articles). */
  k: z.string(),
})
const timelineSchema = z.object({ schools: z.array(schoolSchema), events: z.array(eventSchema) })

export type TimelineSchool = z.infer<typeof schoolSchema>
export type TimelineEvent = z.infer<typeof eventSchema>
export interface TimelineData {
  schools: TimelineSchool[]
  /** Du plus ancien au plus récent. */
  events: TimelineEvent[]
}

/** Lecture stricte de la réponse de la base ; trie les événements au cas où. */
export function parseTimeline(raw: unknown): TimelineData {
  const data = timelineSchema.parse(raw)
  const events = data.events.every((e, i) => i === 0 || (data.events[i - 1]?.t ?? 0) <= e.t)
    ? data.events
    : [...data.events].sort((a, b) => a.t - b.t)
  return { schools: data.schools, events }
}

const HOUR = 3_600_000

/** Premier index dont l'heure est strictement supérieure à `t` (événements triés). */
function firstAfter(events: ReadonlyArray<TimelineEvent>, t: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((events[mid]?.t ?? Infinity) <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * La carte telle qu'elle était à l'instant `at` : même règle que la vue « direct » de la base
 * (dernier signalement de chaque établissement dans les `hours` précédentes, statut = celui du
 * dernier), mais décalée à `at`. Fenêtre : ]at - hours, at].
 */
export function statusesAt(data: TimelineData, at: number, hours: number): SchoolStatus[] {
  const { events } = data
  const end = firstAfter(events, at)
  const start = firstAfter(events, at - hours * HOUR)
  const latest = new Map<string, { status: ReportStatus; t: number }>()
  const sources = new Map<string, Set<string>>()
  for (let i = start; i < end; i++) {
    const e = events[i]
    if (!e) continue
    // Triés par heure : le dernier vu est le plus récent.
    latest.set(e.u, { status: e.s, t: e.t })
    let set = sources.get(e.u)
    if (!set) sources.set(e.u, (set = new Set()))
    set.add(e.k)
  }
  const byUai = new Map(data.schools.map((s) => [s.uai, s]))
  const out: SchoolStatus[] = []
  for (const [uai, last] of latest) {
    const school = byUai.get(uai)
    if (!school) continue
    out.push({
      uai,
      name: school.name,
      city: school.city,
      department: school.department,
      academy: school.academy,
      lat: school.lat,
      lng: school.lng,
      level: school.level,
      status: last.status,
      last_signal_at: new Date(last.t).toISOString(),
      source_count: sources.get(uai)?.size ?? 1,
    })
  }
  return out.sort((a, b) => b.last_signal_at.localeCompare(a.last_signal_at))
}

// --- Fenêtre affichée par la frise ---------------------------------------------------------

export const TIMELINE_RANGES = ['24h', '3j', '7j', 'tout'] as const
export type TimelineRange = (typeof TIMELINE_RANGES)[number]
export const DEFAULT_TIMELINE_RANGE: TimelineRange = '24h'

export const TIMELINE_RANGE_LABELS: Record<TimelineRange, string> = {
  '24h': '24 h',
  '3j': '3 jours',
  '7j': '7 jours',
  tout: 'Tout',
}

const RANGE_HOURS: Record<Exclude<TimelineRange, 'tout'>, number> = {
  '24h': 24,
  '3j': 72,
  '7j': 168,
}

/** Début de la frise ; jamais avant le début du mouvement. */
export function rangeStart(range: TimelineRange, settings: PublicSettings, now: number): number {
  const start = periodSince('tout', settings, now).getTime()
  if (range === 'tout') return start
  return Math.max(start, now - RANGE_HOURS[range] * HOUR)
}

/** Durées proposées pour « un signalement reste affiché » : le réglage du site, plus quelques choix. */
export function hourChoices(ttl: number): number[] {
  return [...new Set([1, 3, 6, 12, 24, 48, ttl])].sort((a, b) => a - b)
}

// --- Lecture (play) ------------------------------------------------------------------------

export const PLAY_SPEEDS = [1, 2, 4] as const
/** Durée d'un parcours complet de la frise à la vitesse ×1. */
export const PLAY_SECONDS = 30

/** Avance de la tête de lecture pour `dtMs` de temps réel. */
export function advance(at: number, dtMs: number, from: number, to: number, speed: number): number {
  const next = at + ((to - from) / (PLAY_SECONDS * 1000)) * dtMs * speed
  return Math.min(to, Math.max(from, next))
}

// --- Histogramme ---------------------------------------------------------------------------

export interface Bucket {
  start: number
  bloque: number
  filtrant: number
  leve: number
  total: number
}

const BUCKET_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * 60_000)

/** Largeur d'une barre : la plus petite « ronde » qui donne au plus ~96 barres. */
export function bucketSize(rangeMs: number, maxBars = 96): number {
  return BUCKET_STEPS.find((s) => rangeMs / s <= maxBars) ?? 1440 * 60_000
}

/** Signalements par tranche de temps sur [from, to], par statut. */
export function bucketize(
  events: ReadonlyArray<TimelineEvent>,
  from: number,
  to: number,
  size: number,
): Bucket[] {
  const count = Math.max(1, Math.ceil((to - from) / size))
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    start: from + i * size,
    bloque: 0,
    filtrant: 0,
    leve: 0,
    total: 0,
  }))
  for (let i = firstAfter(events, from - 1); i < events.length; i++) {
    const e = events[i]
    if (!e || e.t > to) break
    const b = buckets[Math.min(count - 1, Math.floor((e.t - from) / size))]
    if (!b) continue
    b[e.s]++
    b.total++
  }
  return buckets
}

// --- Dates (heure de Paris) ----------------------------------------------------------------

const parisFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Paris',
})

function parisParts(ms: number) {
  const get: Record<string, string> = {}
  for (const p of parisFmt.formatToParts(new Date(ms))) get[p.type] = p.value
  return {
    weekday: get.weekday ?? '',
    day: get.day ?? '',
    month: get.month ?? '',
    hour: get.hour ?? '00',
    minute: get.minute ?? '00',
  }
}

/** « mer. 8 oct. · 14 h 30 » */
export function fmtMoment(ms: number): string {
  const p = parisParts(ms)
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour} h ${p.minute}`
}

/** « 8 oct. à 14 h 30 », pour les phrases. */
export function fmtMomentShort(ms: number): string {
  const p = parisParts(ms)
  return `${p.day} ${p.month} à ${p.hour} h ${p.minute}`
}

/** Graduation de l'axe : l'heure sur une courte période, le jour sinon. */
export function fmtTick(ms: number, rangeMs: number): string {
  const p = parisParts(ms)
  return rangeMs <= 3 * 24 * HOUR ? `${p.day} ${p.month} ${p.hour} h` : `${p.day} ${p.month}`
}

/** Durée écoulée en clair : « il y a 3 h », « il y a 2 j ». */
export function fmtAgo(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 2) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}
