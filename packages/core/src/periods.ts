/**
 * Viewing periods of the map and the lists. "live" follows the status TTL; the others go back in
 * time, never before the start of the movement (a setting).
 */
import { parisMidnight } from './dates.ts'
import type { PublicSettings } from './settings.ts'

export const PERIODS = ['live', '24h', '7d', 'all'] as const
export type Period = (typeof PERIODS)[number]

/** Past periods never look further back than this (reports older than a year are archives). */
export const MAX_LOOKBACK_DAYS = 366

type PeriodSettings = Pick<PublicSettings, 'status_ttl_hours' | 'movement_start'>

/** Start of a period, never before the start of the movement. */
export function periodSince(
  period: Period,
  settings: PeriodSettings,
  now: Date = new Date(),
): Date {
  const start = parisMidnight(settings.movement_start)
  const hours = { live: settings.status_ttl_hours, '24h': 24, '7d': 24 * 7, all: Infinity }[period]
  if (hours === Infinity) return start
  const since = new Date(now.getTime() - hours * 3_600_000)
  return since < start ? start : since
}
