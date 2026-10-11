/**
 * The ingestion pipeline's vocabulary and its pure rules: the stages an item goes through, the
 * states and lanes it can rest in, how a flaky source is paused (circuit breaker) and how the same
 * article received twice is merged. No I/O: the server and the admin both import this.
 *
 *   discover → read (fetch + normalise) → dedupe → relevance → extract (AI) →
 *   match (school) → date → judge → store (+ moderation)
 */
import { canonicalUrl } from './domain.ts'

export const STAGES = [
  'discover',
  'read',
  'dedupe',
  'relevance',
  'extract',
  'match',
  'date',
  'judge',
  'store',
] as const
export type Stage = (typeof STAGES)[number]

/**
 * Where an item rests.
 * Moving: discovered → read → extracted → done.
 * Ends: irrelevant (off topic), duplicate (merged into another item), no_event (the AI found no
 * fact), done.
 * Lanes, which need attention or a retry: unreadable (blocked, empty or paywalled page),
 * deferred (AI off, budget reached or time budget spent: retried automatically), failed (a stage
 * failed after its retries: an admin can retry it).
 */
export const ITEM_STATES = [
  'discovered',
  'read',
  'extracted',
  'done',
  'irrelevant',
  'duplicate',
  'no_event',
  'unreadable',
  'deferred',
  'failed',
] as const
export type ItemState = (typeof ITEM_STATES)[number]

export const LANES = ['unreadable', 'deferred', 'failed'] as const
export type Lane = (typeof LANES)[number]
export const isLane = (state: string): state is Lane => (LANES as readonly string[]).includes(state)

/** States an item never leaves by itself. */
export const TERMINAL_STATES: readonly ItemState[] = ['done', 'irrelevant', 'duplicate', 'no_event']

/** The stage that moves an item out of a state (what a retry of a lane runs). */
export const NEXT_STAGE: Partial<Record<ItemState, Stage>> = {
  discovered: 'read',
  read: 'extract',
  extracted: 'match',
}

/** What became of one fact the AI extracted. */
export const EXTRACTION_OUTCOMES = [
  'reported', // a report was stored
  'duplicate', // the same report already exists
  'low_certainty',
  'stale', // dated more than 7 days before the article
  'weekend', // a lycée "blocked" on a Saturday or Sunday
  'unmatched', // no school found: waits in the staff queue
  'no_source', // the source link is unusable
  'failed',
] as const
export type ExtractionOutcome = (typeof EXTRACTION_OUTCOMES)[number]

// --- Source circuit breaker -------------------------------------------------------------

export type SourceHealth = 'closed' | 'open' | 'half_open'

export interface SourceState {
  health: SourceHealth
  consecutiveFailures: number
  nextAttemptAt: Date | null
}

export const BREAKER = {
  /** Consecutive failures that pause a source. */
  threshold: 3,
  /** First pause; it doubles with each further failure, up to `maxPauseMs`. */
  basePauseMs: 15 * 60_000,
  maxPauseMs: 6 * 3_600_000,
} as const

/** May this source be fetched now? An open breaker lets one attempt through once its pause is over. */
export function mayAttempt(state: SourceState, now: Date): boolean {
  if (state.health !== 'open') return true
  return state.nextAttemptAt === null || state.nextAttemptAt.getTime() <= now.getTime()
}

/** The state to store before an attempt: an open breaker whose pause is over tries once ("half open"). */
export function beforeAttempt(state: SourceState, now: Date): SourceState {
  return state.health === 'open' && mayAttempt(state, now)
    ? { ...state, health: 'half_open' }
    : state
}

/** The state after an attempt. Success closes the breaker; failures pause the source with a growing delay. */
export function afterAttempt(state: SourceState, ok: boolean, now: Date): SourceState {
  if (ok) return { health: 'closed', consecutiveFailures: 0, nextAttemptAt: null }
  const consecutiveFailures = state.consecutiveFailures + 1
  // A failed trial of a half-open breaker reopens it at once, whatever the count.
  if (state.health !== 'half_open' && consecutiveFailures < BREAKER.threshold)
    return { health: 'closed', consecutiveFailures, nextAttemptAt: null }
  const doublings = Math.max(0, consecutiveFailures - BREAKER.threshold)
  const pause = Math.min(BREAKER.maxPauseMs, BREAKER.basePauseMs * 2 ** doublings)
  return {
    health: 'open',
    consecutiveFailures,
    nextAttemptAt: new Date(now.getTime() + pause),
  }
}

// --- Merging the same article ----------------------------------------------------------

export interface Mergeable {
  url: string
  text: string
  /** Points of a map and always-relevant items are never merged. */
  geo?: unknown
  alwaysRelevant?: boolean
}

/**
 * The same article received by several sources in one pass (press feeds, Google News queries,
 * Bluesky accounts…) is sent to the AI once, on the union of the texts received: no fact is lost
 * (each source sometimes brings a different piece) and only one call is paid.
 */
export function mergeSameArticle<T extends Mergeable>(
  items: readonly T[],
): { kept: T[]; absorbed: Array<{ item: T; into: T }> } {
  const kept: T[] = []
  const absorbed: Array<{ item: T; into: T }> = []
  const byUrl = new Map<string, number>()
  for (const item of items) {
    if (item.geo || item.alwaysRelevant) {
      kept.push(item)
      continue
    }
    const key = canonicalUrl(item.url)
    const at = byUrl.get(key)
    if (at === undefined) {
      byUrl.set(key, kept.length)
      kept.push(item)
      continue
    }
    const head = kept[at] as T
    const known = new Set(head.text.split('\n').map((l) => l.trim().toLowerCase()))
    const extra = item.text
      .split('\n')
      .filter((l) => l.trim() && !known.has(l.trim().toLowerCase()))
    if (extra.length) kept[at] = { ...head, text: `${head.text}\n${extra.join('\n')}` }
    absorbed.push({ item, into: kept[at] as T })
  }
  return { kept, absorbed }
}
