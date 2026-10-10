import { pgEnum } from 'drizzle-orm/pg-core'
import {
  CERTAINTIES,
  DATE_BASES,
  JUDGE_LEVELS,
  JUDGE_NATURES,
  MODERATION_STATES,
  REPORT_ORIGINS,
  REPORT_STATUSES,
  SCHOOL_LEVELS,
  TIERS,
} from '@manifeste/core'

export const reportStatus = pgEnum('report_status', REPORT_STATUSES)
export const reportOrigin = pgEnum('report_origin', REPORT_ORIGINS)
export const moderationState = pgEnum('moderation_state', MODERATION_STATES)
export const schoolLevel = pgEnum('school_level', SCHOOL_LEVELS)
export const certainty = pgEnum('certainty', CERTAINTIES)
export const dateBasis = pgEnum('date_basis', DATE_BASES)
export const tier = pgEnum('tier', TIERS)
export const judgeNature = pgEnum('judge_nature', JUDGE_NATURES)
export const judgeLevel = pgEnum('judge_level', JUDGE_LEVELS)

/** Kinds of collected sources. Adding one = an ingestion adapter + a value here. */
export const SOURCE_KINDS = ['telegram', 'rss', 'bluesky', 'mymaps'] as const
export const sourceKind = pgEnum('source_kind', SOURCE_KINDS)

/** Circuit breaker of a source: closed = healthy, open = paused after failures, half_open = trying again. */
export const sourceHealth = pgEnum('source_health', ['closed', 'open', 'half_open'])

/** Pages counted by the anonymous analytics. */
export const ANALYTICS_PAGES = [
  'map',
  'list',
  'school',
  'report',
  'about',
  'data',
  'other',
] as const
export const analyticsPage = pgEnum('analytics_page', ANALYTICS_PAGES)

export const WEB_VITALS = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'API'] as const
export const webVital = pgEnum('web_vital', WEB_VITALS)
