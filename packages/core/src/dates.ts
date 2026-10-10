/**
 * When did a reported fact happen? Articles are often vague ("ce matin", "lundi") or published
 * at night for the day ahead. These rules turn the date the AI extracted (if any) and the
 * publication date into the moment the report is shown on the map. All in Paris time.
 */

const PARIS = 'Europe/Paris'

/** Calendar day in Paris (YYYY-MM-DD). */
export function parisDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(d)
}

/** Saturday or Sunday in Paris: lycées are closed, no blockade happens then. */
export function isParisWeekend(d: Date): boolean {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: PARIS, weekday: 'short' }).format(d)
  return day === 'Sat' || day === 'Sun'
}

export function parisHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, hour: '2-digit', hourCycle: 'h23' }).format(
      d,
    ),
  )
}

/** Paris offset from UTC on that date ("+02:00" in summer, "+01:00" in winter). */
function parisOffset(at: Date): string {
  const label =
    new Intl.DateTimeFormat('en-US', { timeZone: PARIS, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00'
  return label === 'GMT' ? '+00:00' : label.replace('GMT', '')
}

/** Midnight in Paris on that day. */
export function parisMidnight(day: string): Date {
  return new Date(`${day}T00:00:00${parisOffset(new Date(`${day}T12:00:00Z`))}`)
}

/** Time used when the AI only gives a day: when classes start, in Paris. */
const MORNING = '08:00:00'

function morningOf(day: string): Date {
  return new Date(`${day}T${MORNING}${parisOffset(new Date(`${day}T12:00:00Z`))}`)
}

/** The day (YYYY-MM-DD) when the AI gave only a date or midnight, else null. */
function dayOnly(extracted: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
    extracted.trim(),
  )
  return m?.[1] ?? null
}

/** Before this hour (Paris), an article of the day announces the day that starts. */
const NIGHT_END_HOUR = 5
/** An announced fact keeps its announced day up to 3 days after publication. */
const ANNOUNCED_MAX_MS = 3 * 86_400_000
/** More than 7 days before publication: a story, an archive or a retrospective, not news. */
const STALE_MS = 7 * 86_400_000

/** Where the kept date comes from. `stale` facts are dropped. */
export const DATE_BASES = ['extracted', 'announced', 'published'] as const
export type DateBasis = (typeof DATE_BASES)[number]

export interface Observation {
  at: Date
  basis: DateBasis | 'stale'
}

/**
 * The extracted date when plausible, else the publication date.
 * Plausible = not after publication (1 h margin) and at most 7 days before. Exception: a fact
 * announced for a coming day ("fermés ce lundi", published on Sunday) keeps the announced day,
 * within 3 days; it only shows on the map that day.
 */
export function resolveObservation(extracted: string | null, publishedAt: Date): Observation {
  const fallback: Observation = { at: publishedAt, basis: 'published' }
  if (!extracted) return fallback
  const d = new Date(extracted)
  if (Number.isNaN(d.getTime())) return fallback

  // A day alone ("2026-10-05") or midnight: without an hour, a fact dated midnight UTC lands at
  // 2 am in Paris and leaves the map (status TTL) before classes start.
  const day = dayOnly(extracted)
  if (day) {
    const morning = morningOf(day)
    const pubDay = parisDay(publishedAt)
    if (day > pubDay) {
      const ahead = morning.getTime() - publishedAt.getTime() <= ANNOUNCED_MAX_MS
      return ahead ? { at: morning, basis: 'announced' } : fallback
    }
    if (day === pubDay) {
      // Published in the night for the day that starts ("cours à distance ce vendredi" at
      // 0:12): announced for the morning, so it does not show (then expire) before schools open.
      if (parisHour(publishedAt) < NIGHT_END_HOUR) return { at: morning, basis: 'announced' }
      return { at: morning < publishedAt ? morning : publishedAt, basis: 'extracted' }
    }
    return morning.getTime() - publishedAt.getTime() < -STALE_MS
      ? { at: publishedAt, basis: 'stale' }
      : { at: morning, basis: 'extracted' }
  }

  const delta = d.getTime() - publishedAt.getTime()
  if (delta < -STALE_MS) return { at: publishedAt, basis: 'stale' }
  if (delta <= 3_600_000) return { at: d, basis: 'extracted' }
  const announced = delta <= ANNOUNCED_MAX_MS && parisDay(d) > parisDay(publishedAt)
  return announced ? { at: d, basis: 'announced' } : fallback
}

/**
 * Lycées are closed at weekends: a "blocked" lycée report dated on a Saturday or Sunday is not a
 * blockade (usually a story about Friday or an announcement). Higher education is not concerned.
 */
export function isWeekendLyceeBlockade(
  status: string,
  level: string | null | undefined,
  at: Date,
): boolean {
  return status === 'blocked' && level === 'secondary' && isParisWeekend(at)
}
