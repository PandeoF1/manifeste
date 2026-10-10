import type { ReportStatus } from '@shared/status.ts'

export interface NationalStats {
  bloque: number
  filtrant: number
  leve: number
  /** Départements avec au moins un lycée bloqué ou en barrage filtrant. */
  departments: number
  /** Lycées bloqués ou filtrants dont le dernier signal date de moins d'une heure. */
  lastHour: number
}

interface StatusLike {
  status: ReportStatus
  department: string | null
  last_signal_at: string
}

export function computeStats(
  rows: ReadonlyArray<StatusLike>,
  now: number = Date.now(),
): NationalStats {
  const stats: NationalStats = { bloque: 0, filtrant: 0, leve: 0, departments: 0, lastHour: 0 }
  const departments = new Set<string>()
  for (const r of rows) {
    stats[r.status]++
    if (r.status === 'leve') continue
    if (r.department) departments.add(r.department)
    if (now - new Date(r.last_signal_at).getTime() < 3_600_000) stats.lastHour++
  }
  stats.departments = departments.size
  return stats
}
