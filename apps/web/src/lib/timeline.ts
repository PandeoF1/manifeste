import { z } from 'zod'
import { REPORT_STATUSES, type ReportStatus } from '@shared/status.ts'
import { periodSince, type PublicSettings } from './periods'
import type { SchoolStatus } from '@/queries/statuses'

/**
 * Map history: every validated report since the start of the movement, to
 * replay the map at any moment (timeline at the bottom of the map). The data comes from
 * the SQL function timeline_events; everything else (state at time T, histogram) is computed
 * here, in the browser, with no new call while moving through time.
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
  /** School UAI. */
  u: z.string(),
  /** Statut. */
  s: z.enum(REPORT_STATUSES),
  /** Time of the fact, in milliseconds since 1970. */
  t: z.number(),
  /** Source key (a source counts for one, however many articles). Absent for an on-site report. */
  k: z.string().nullable(),
  /** Reported mobilisation (judge tiers): not part of the counted statuses. */
  m: z.boolean().optional(),
})
const timelineSchema = z.object({ schools: z.array(z.unknown()), events: z.array(z.unknown()) })

export type TimelineSchool = z.infer<typeof schoolSchema>
export type TimelineEvent = z.infer<typeof eventSchema>
export interface TimelineData {
  schools: TimelineSchool[]
  /** Oldest to newest. */
  events: TimelineEvent[]
}

/** Keeps valid rows: one damaged row must not make the whole timeline disappear. */
function keepValid<T>(schema: z.ZodType<T>, rows: unknown[]): T[] {
  const out: T[] = []
  for (const row of rows) {
    const parsed = schema.safeParse(row)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/** Reads the database response (strict overall shape, tolerant rows); sorts the events. */
export function parseTimeline(raw: unknown): TimelineData {
  const data = timelineSchema.parse(raw)
  const schools = keepValid(schoolSchema, data.schools)
  const events = keepValid(eventSchema, data.events)
  const sorted = events.every((e, i) => i === 0 || (events[i - 1]?.t ?? 0) <= e.t)
  return { schools, events: sorted ? events : events.sort((a, b) => a.t - b.t) }
}

const HOUR = 3_600_000

/** First index whose time is strictly greater than `t` (events sorted). */
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
 * The map as it was at time `at`: same rule as the database's "direct" view
 * (latest report of each school in the preceding `hours`, status = that of the
 * latest), but shifted to `at`. Window: ]at - hours, at].
 */
export function statusesAt(data: TimelineData, at: number, hours: number): SchoolStatus[] {
  return stateAt(data, at, hours, false)
}

/**
 * Reported mobilisations at time `at`: schools that only have, in the window,
 * mobilisation events (nothing counted). Same window as `statusesAt`.
 */
export function mobilisationAt(data: TimelineData, at: number, hours: number): SchoolStatus[] {
  const counted = new Set(stateAt(data, at, hours, false).map((s) => s.uai))
  return stateAt(data, at, hours, true)
    .filter((s) => !counted.has(s.uai) && s.status !== 'leve')
    .map((s) => ({ ...s, mobilisation: true }))
}

function stateAt(
  data: TimelineData,
  at: number,
  hours: number,
  mobilisation: boolean,
): SchoolStatus[] {
  const { events } = data
  const end = firstAfter(events, at)
  const start = firstAfter(events, at - hours * HOUR)
  const latest = new Map<string, { status: ReportStatus; t: number }>()
  const sources = new Map<string, Set<string>>()
  for (let i = start; i < end; i++) {
    const e = events[i]
    if (!e || (e.m === true) !== mobilisation) continue
    // Sorted by time: the last one seen is the most recent.
    latest.set(e.u, { status: e.s, t: e.t })
    let set = sources.get(e.u)
    if (!set) sources.set(e.u, (set = new Set()))
    if (e.k !== null) set.add(e.k)
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
      source_count: sources.get(uai)?.size ?? 0,
    })
  }
  return out.sort((a, b) => b.last_signal_at.localeCompare(a.last_signal_at))
}

// --- Window shown by the timeline ---------------------------------------------------------

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

/** Start of the timeline; never before the start of the movement. */
export function rangeStart(range: TimelineRange, settings: PublicSettings, now: number): number {
  const start = periodSince('tout', settings, now).getTime()
  if (range === 'tout') return start
  return Math.max(start, now - RANGE_HOURS[range] * HOUR)
}

/** Durations offered for "a report stays shown": the site setting, the current value (shared link), plus a few choices. */
export function hourChoices(ttl: number, ...also: number[]): number[] {
  return [...new Set([1, 3, 6, 12, 24, 48, ttl, ...also])].sort((a, b) => a - b)
}

// --- Lecture (play) ------------------------------------------------------------------------

export const PLAY_SPEEDS = [1, 2, 4] as const
/** Duration of a full pass through the timeline at ×1 speed. */
export const PLAY_SECONDS = 30

/** Advance of the playhead for `dtMs` of real time. */
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

/** Width of a bar: the smallest "round" one that gives at most ~96 bars. */
export function bucketSize(rangeMs: number, maxBars = 96): number {
  return BUCKET_STEPS.find((s) => rangeMs / s <= maxBars) ?? 1440 * 60_000
}

/** Reports per time slot over [from, to], by status. */
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
    if (e.m === true) continue
    const b = buckets[Math.min(count - 1, Math.floor((e.t - from) / size))]
    if (!b) continue
    b[e.s]++
    b.total++
  }
  return buckets
}

// --- Dates (Paris time) ----------------------------------------------------------------

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

/** "mer. 8 oct. · 14 h 30" */
export function fmtMoment(ms: number): string {
  const p = parisParts(ms)
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour} h ${p.minute}`
}

/** "8 oct. à 14 h 30", for sentences. */
export function fmtMomentShort(ms: number): string {
  const p = parisParts(ms)
  return `${p.day} ${p.month} à ${p.hour} h ${p.minute}`
}

/** Axis tick: the hour over a short period, the day otherwise. */
export function fmtTick(ms: number, rangeMs: number): string {
  const p = parisParts(ms)
  return rangeMs <= 3 * 24 * HOUR ? `${p.day} ${p.month} ${p.hour} h` : `${p.day} ${p.month}`
}

/** Elapsed time in plain words: "il y a 3 h", "il y a 2 j". */
export function fmtAgo(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 2) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}
