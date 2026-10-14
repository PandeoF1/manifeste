/**
 * Who publishes a collected report, without a human:
 * 1. a trusted source, or a source URL on a trusted domain: approved at once;
 * 2. otherwise two independent sources agree (same school, same status, within the concordance
 *    window): both are approved;
 * 3. otherwise the report waits in the moderation queue.
 * On-site reports always go to moderation (a human checks the photo and position).
 */
import type { ModerationState, ReportOrigin, ReportStatus } from './status.ts'

export const DEFAULT_CONCORDANCE_WINDOW_HOURS = 2

/** Two reports count as independent when their source keys differ. */
export const sourceKey = (sourceId: string | null, domain: string | null): string | null =>
  sourceId ? `src:${sourceId}` : domain ? `dom:${domain}` : null

export interface ReportForValidation {
  id?: string
  schoolUai: string
  status: ReportStatus
  origin: ReportOrigin
  observedAt: Date
  sourceId: string | null
  sourceDomain: string | null
  moderation: ModerationState
}

export interface ValidationContext {
  sourceTrusted: boolean
  domainTrusted: boolean
  /** Other collected reports for the same school and status, near in time (from the database). */
  neighbours: ReadonlyArray<ReportForValidation>
  windowHours?: number
}

export interface ValidationDecision {
  moderation: ModerationState
  reason: 'on_site' | 'trusted_source' | 'trusted_domain' | 'concordant' | 'awaiting_moderation'
  /** Pending reports this one confirms (to approve in the same transaction). */
  promote: string[]
}

/** True when `other` independently confirms `report`. */
export function isConcordant(
  report: ReportForValidation,
  other: ReportForValidation,
  windowHours = DEFAULT_CONCORDANCE_WINDOW_HOURS,
): boolean {
  if (other.origin === 'on_site' || other.moderation === 'rejected') return false
  if (other.schoolUai !== report.schoolUai || other.status !== report.status) return false
  if (Math.abs(other.observedAt.getTime() - report.observedAt.getTime()) > windowHours * 3_600_000)
    return false
  return (
    sourceKey(other.sourceId, other.sourceDomain) !==
    sourceKey(report.sourceId, report.sourceDomain)
  )
}

export function decideModeration(
  report: ReportForValidation,
  ctx: ValidationContext,
): ValidationDecision {
  if (report.origin === 'on_site') return { moderation: 'pending', reason: 'on_site', promote: [] }
  const concordant = ctx.neighbours.filter((n) => isConcordant(report, n, ctx.windowHours))
  const promote = concordant
    .filter((n) => n.moderation === 'pending' && n.id !== undefined && n.id !== report.id)
    .map((n) => n.id as string)
  if (ctx.sourceTrusted) return { moderation: 'approved', reason: 'trusted_source', promote }
  if (ctx.domainTrusted) return { moderation: 'approved', reason: 'trusted_domain', promote }
  if (concordant.length > 0) return { moderation: 'approved', reason: 'concordant', promote }
  return { moderation: 'pending', reason: 'awaiting_moderation', promote: [] }
}
