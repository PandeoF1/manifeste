import type { ReportStatus } from '@manifeste/core'

export interface NationalStats {
  blocked: number
  filtering: number
  lifted: number
  /** Departments with at least one blocked or filtering school. */
  departments: number
  /** Blocked or filtering schools whose latest signal is less than an hour old. */
  lastHour: number
  /**
   * Blockade-days over the period: one per school and per day with a signal (three reports on a
   * Monday count once, Monday and Tuesday count twice). Null when the period carries no daily count
   * (live, history replay).
   */
  blockedDays: number | null
}

interface StatusLike {
  status: ReportStatus
  department: string | null
  lastSignalAt: Date
  signalDays?: number
}

export function computeStats(
  rows: ReadonlyArray<StatusLike>,
  now: number = Date.now(),
): NationalStats {
  const stats: NationalStats = {
    blocked: 0,
    filtering: 0,
    lifted: 0,
    departments: 0,
    lastHour: 0,
    blockedDays: null,
  }
  const departments = new Set<string>()
  for (const r of rows) {
    stats[r.status]++
    if (r.signalDays !== undefined) stats.blockedDays = (stats.blockedDays ?? 0) + r.signalDays
    if (r.status === 'lifted') continue
    if (r.department) departments.add(r.department)
    if (now - r.lastSignalAt.getTime() < 3_600_000) stats.lastHour++
  }
  stats.departments = departments.size
  return stats
}
