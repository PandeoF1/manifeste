/**
 * Confidence tier of a report, from the judge's second opinion (Jev).
 * - confirmed: the text says the school is blocked or closed (probability ≥ keep, nature
 *   blockade or closed; for "lifted" the score alone is enough). On-site reports are always confirmed.
 * - mobilisation: something happens (gathering, incident, unclear case) but the text does not say
 *   the entrance is blocked or the school closed. Never counted as blocked.
 * - not_retained: story, preview, opinion, wrong school: kept, never shown or counted.
 * - unjudged: unreadable page, no opinion: counted as confirmed until judged.
 * The tiers only apply when the `judgeTiers` setting is on (reversible from the admin).
 */
export const TIERS = ['confirmed', 'mobilisation', 'not_retained', 'unjudged'] as const
export type Tier = (typeof TIERS)[number]

export const JUDGE_NATURES = ['blockade', 'closed', 'gathering', 'incident', 'other'] as const
export type JudgeNature = (typeof JUDGE_NATURES)[number]

export const JUDGE_LEVELS = ['secondary', 'higher', 'unknown'] as const
export type JudgeLevel = (typeof JUDGE_LEVELS)[number]

export interface TierThresholds {
  keep: number
  low: number
}

export const DEFAULT_TIER_THRESHOLDS: TierThresholds = { keep: 0.5, low: 0.3 }

export interface TierInput {
  probability: number | null
  nature: JudgeNature | null
  status: string
  onSite?: boolean
  /** The judge places the school at another level than the directory (lycée vs fac). */
  levelConflict?: boolean
}

export function tierOf(r: TierInput, t: TierThresholds = DEFAULT_TIER_THRESHOLDS): Tier {
  if (r.onSite) return 'confirmed'
  if (r.probability === null) return 'unjudged'
  if (r.levelConflict) return 'not_retained'
  if (r.probability >= t.keep)
    return r.status === 'lifted' || r.nature === 'blockade' || r.nature === 'closed'
      ? 'confirmed'
      : 'mobilisation'
  if (r.probability >= t.low) return 'mobilisation'
  return r.nature === 'gathering' || r.nature === 'incident' ? 'mobilisation' : 'not_retained'
}

/** Counted in statuses and figures: every report when tiers are off, else confirmed and unjudged. */
export const countsAsStatus = (tier: Tier, tiersOn: boolean): boolean =>
  !tiersOn || tier === 'confirmed' || tier === 'unjudged'

/** Shown apart on the map as "mobilisation signalée" (never as blocked). */
export const isMobilisation = (tier: Tier, status: string, tiersOn: boolean): boolean =>
  tiersOn && tier === 'mobilisation' && status !== 'lifted'

/** Visible to the public at all (in a status or as a mobilisation). */
export const isListed = (tier: Tier, status: string, tiersOn: boolean): boolean =>
  countsAsStatus(tier, tiersOn) || isMobilisation(tier, status, tiersOn)
