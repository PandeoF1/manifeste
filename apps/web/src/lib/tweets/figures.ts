// Figures for a tweet over a chosen range, computed from the public open data (no AI, no cost).
// Daily rows count the schools reported that day; they cannot be added up into "distinct
// schools" over several days, so only "all" (the summary) gives a distinct total, and the other
// ranges give the peak of one day, which is exact.
import { departmentName } from '@/config/departments'
import type { Jour, Resume, Zone } from '@/queries/donnees'

export const RANGES = ['today', '7d', '30d', 'all'] as const
export type Range = (typeof RANGES)[number]

export const RANGE_LABEL: Record<Range, string> = {
  today: "Aujourd'hui",
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  all: 'Depuis le début',
}

/** A curve over one day says nothing: "today" draws the last two weeks, today highlighted. */
const TODAY_CURVE_DAYS = 14

export interface TweetData {
  resume: Resume
  jours: ReadonlyArray<Jour>
  departements: ReadonlyArray<Zone>
  /** AAAA-MM-JJ, Paris time. */
  today: string
}

export interface Figures {
  range: Range
  /** The days the range covers (what the headline is computed from). */
  days: Jour[]
  /** The days drawn on the curve (a wider window for "today"). */
  curve: Jour[]
  /** Schools reported: distinct since the start ("all"), else the peak of one day. */
  schools: number
  schoolsIsPeak: boolean
  peak: { jour: string; etablissements: number } | null
  departments: number
  reports: number
  facs: number
  /** Last day with data in the range. */
  lastDay: string | null
  nowBlocked: number
  nowFiltering: number
  firstDay: string | null
}

const sortByDay = (days: ReadonlyArray<Jour>) =>
  [...days].sort((a, b) => a.jour.localeCompare(b.jour))

/** AAAA-MM-JJ shifted by `delta` days (UTC arithmetic: only dates, no time of day). */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** The days of the range, oldest first. */
export function daysOf(jours: ReadonlyArray<Jour>, range: Range, today: string): Jour[] {
  const sorted = sortByDay(jours)
  if (range === 'all') return sorted
  if (range === 'today') return sorted.filter((j) => j.jour === today)
  const since = shiftDay(today, range === '7d' ? -6 : -29)
  return sorted.filter((j) => j.jour >= since && j.jour <= today)
}

export function figuresFor(data: TweetData, range: Range): Figures {
  const days = daysOf(data.jours, range, data.today)
  const curve =
    range === 'today'
      ? sortByDay(data.jours).filter(
          (j) => j.jour >= shiftDay(data.today, -(TODAY_CURVE_DAYS - 1)) && j.jour <= data.today,
        )
      : days
  const peakOf = (list: ReadonlyArray<Jour>) =>
    list.reduce<Jour | null>(
      (best, j) => (!best || j.etablissements > best.etablissements ? j : best),
      null,
    )
  const peakDay = peakOf(days)
  // The peak shown is the one of the curve drawn (two weeks for "today", else the range).
  const curvePeak = peakOf(curve)
  const all = range === 'all'
  const last = days.at(-1) ?? null
  return {
    range,
    days,
    curve,
    schools: all ? data.resume.etablissements : (peakDay?.etablissements ?? 0),
    schoolsIsPeak: !all,
    peak: curvePeak ? { jour: curvePeak.jour, etablissements: curvePeak.etablissements } : null,
    departments: all
      ? data.resume.departements
      : days.reduce((m, j) => Math.max(m, j.departements), 0),
    reports: all ? data.resume.signalements : days.reduce((s, j) => s + j.signalements, 0),
    facs: all ? data.resume.facs : days.reduce((m, j) => Math.max(m, j.facs), 0),
    lastDay: last?.jour ?? null,
    firstDay: days[0]?.jour ?? null,
    nowBlocked: data.resume.en_ce_moment.bloques,
    nowFiltering: data.resume.en_ce_moment.filtrants,
  }
}

/** The departments with the most schools reported since the start. */
export function topDepartments(
  zones: ReadonlyArray<Zone>,
  n: number,
): Array<{ code: string; name: string; schools: number }> {
  return [...zones]
    .sort((a, b) => b.etablissements - a.etablissements)
    .slice(0, n)
    .map((z) => ({ code: z.zone, name: departmentName(z.zone), schools: z.etablissements }))
}

/** Today's date in Paris, AAAA-MM-JJ. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now)
}
