/** What a report says about a school. The UI shows them in French ("Bloqué", "Barrage filtrant", "Levé"). */
export const REPORT_STATUSES = ['blocked', 'filtering', 'lifted'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

/** Blocked and filtering are "active": what the counts and curves add up. */
export const isActiveStatus = (status: ReportStatus): boolean => status !== 'lifted'

/** When several reports compete for one school, the strongest status wins. */
export const STATUS_RANK: Record<ReportStatus, number> = { blocked: 0, filtering: 1, lifted: 2 }

export const DEFAULT_STATUS_TTL_HOURS = 5

/** A status expires when no validated report arrived for `ttlHours`. */
export function isStatusExpired(
  lastSignalAt: Date,
  now: Date = new Date(),
  ttlHours: number = DEFAULT_STATUS_TTL_HOURS,
): boolean {
  return now.getTime() - lastSignalAt.getTime() >= ttlHours * 3_600_000
}

/** Where a report comes from. */
export const REPORT_ORIGINS = ['press', 'union', 'aggregator', 'on_site'] as const
export type ReportOrigin = (typeof REPORT_ORIGINS)[number]

export const MODERATION_STATES = ['pending', 'approved', 'rejected'] as const
export type ModerationState = (typeof MODERATION_STATES)[number]

/** Lycée (and other secondary schools) or higher education (universities, IUT, écoles). */
export const SCHOOL_LEVELS = ['secondary', 'higher'] as const
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number]

/** French school identifier (UAI): 7 digits and a letter. */
export const UAI_PATTERN = /^[0-9]{7}[A-Z]$/
export const isUai = (value: string): boolean => UAI_PATTERN.test(value)
