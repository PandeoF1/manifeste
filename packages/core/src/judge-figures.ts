/**
 * What the key figures would be if only some tiers counted: the admin's "Judge" page compares
 * today's figures (no judge) with stricter sets before the judge tiers are switched on.
 */
import type { SchoolLevel, ReportStatus } from './status.ts'
import type { Tier } from './tiers.ts'

export interface FigureRow {
  uai: string
  department: string | null
  level: SchoolLevel
  status: ReportStatus
  observedAt: Date
  domain: string | null
  tier: Tier
  /** What the judge said the report is about (null: not judged). */
  nature: string | null
}

export interface Figures {
  schools: number
  /** The best single day, in Paris time. */
  peak: { day: string; schools: number }
  departments: number
  higherEducation: number
  sources: number
  now: { total: number; blocked: number }
  /** Among the schools, the clearest nature of their reports. */
  natures: Record<string, number>
}

const parisDayOf = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d)
const rank = (n: string | undefined) => (n === 'blockade' ? 3 : n === 'closed' ? 2 : n ? 1 : 0)

/** Blocked or filtering schools (lifted ones are not active) over the rows of the given tiers. */
export function figures(
  rows: ReadonlyArray<FigureRow>,
  tiers: ReadonlyArray<Tier>,
  now: Date,
  ttlHours = 5,
): Figures {
  const kept = rows.filter((r) => tiers.includes(r.tier) && r.observedAt <= now)
  const active = kept.filter((r) => r.status !== 'lifted')
  const byDay = new Map<string, Set<string>>()
  for (const r of active) {
    const d = parisDayOf(r.observedAt)
    byDay.set(d, (byDay.get(d) ?? new Set()).add(r.uai))
  }
  const peak = [...byDay.entries()].sort((a, b) => b[1].size - a[1].size)[0]
  const live = new Map<string, FigureRow>()
  for (const r of kept) {
    if (now.getTime() - r.observedAt.getTime() > ttlHours * 3_600_000) continue
    const cur = live.get(r.uai)
    if (!cur || r.observedAt > cur.observedAt) live.set(r.uai, r)
  }
  const current = [...live.values()].filter((r) => r.status !== 'lifted')
  const best = new Map<string, string>()
  for (const r of active) {
    const n = r.nature ?? 'unjudged'
    if (rank(n) > rank(best.get(r.uai))) best.set(r.uai, n)
  }
  const natures: Record<string, number> = {}
  for (const n of best.values()) natures[n] = (natures[n] ?? 0) + 1
  return {
    schools: new Set(active.map((r) => r.uai)).size,
    peak: { day: peak?.[0] ?? '', schools: peak?.[1].size ?? 0 },
    departments: new Set(active.map((r) => r.department)).size,
    higherEducation: new Set(active.filter((r) => r.level === 'higher').map((r) => r.uai)).size,
    sources: new Set(active.map((r) => r.domain).filter(Boolean)).size,
    now: { total: current.length, blocked: current.filter((r) => r.status === 'blocked').length },
    natures,
  }
}
