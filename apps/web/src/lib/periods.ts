// Viewing periods of the map and the list. "direct" follows status_ttl_hours; the others go
// back in time to the start of the movement (adjustable in the admin). The names are the ones
// in shared links (?periode=7j); the API's own names are in @manifeste/core.
import type { Period as ApiPeriod } from '@manifeste/core'

export const PERIODS = ['direct', '24h', '7j', 'tout'] as const
export type Period = (typeof PERIODS)[number]

/** The API's name for a period of the site. */
export const API_PERIOD: Record<Period, ApiPeriod> = {
  direct: 'live',
  '24h': '24h',
  '7j': '7d',
  tout: 'all',
}

export interface PublicSettings {
  statusTtlHours: number
  /** AAAA-MM-JJ */
  movementStart: string
  /** Judge tiers on: the map shows reported mobilisations apart. */
  judgeTiers: boolean
  /** The public Mouvements pages are shown (off until they are wanted). */
  movementsPublic: boolean
}

export const DEFAULT_SETTINGS: PublicSettings = {
  statusTtlHours: 5,
  movementStart: '2026-09-14',
  judgeTiers: false,
  movementsPublic: false,
}

export const PERIOD_SHORT_LABELS: Record<Period, string> = {
  direct: 'Direct',
  '24h': '24 h',
  '7j': '7 jours',
  tout: 'Tout',
}

const dayFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
})

/** Start date of the movement, midnight Paris time (approximated as UTC+2 outside winter). */
function movementStartDate(movementStart: string): Date {
  const d = new Date(`${movementStart}T00:00:00+02:00`)
  return Number.isNaN(d.getTime())
    ? new Date(`${DEFAULT_SETTINGS.movementStart}T00:00:00+02:00`)
    : d
}

/** Start of the period; never before the start of the movement. */
export function periodSince(period: Period, settings: PublicSettings, now = Date.now()): Date {
  const start = movementStartDate(settings.movementStart)
  const hours = { direct: settings.statusTtlHours, '24h': 24, '7j': 24 * 7, tout: Infinity }[period]
  if (hours === Infinity) return start
  const since = new Date(now - hours * 3_600_000)
  return since < start ? start : since
}

/** Sentence describing the period: "ces 5 dernières heures", "depuis le 14 septembre". */
export function periodDescription(period: Period, settings: PublicSettings): string {
  switch (period) {
    case 'direct':
      return settings.statusTtlHours === 1
        ? 'cette dernière heure'
        : `ces ${settings.statusTtlHours} dernières heures`
    case '24h':
      return 'ces dernières 24 heures'
    case '7j':
      return 'ces 7 derniers jours'
    case 'tout':
      return `depuis le ${dayFmt.format(movementStartDate(settings.movementStart))}`
  }
}

/** The settings the API serves (snake_case, validated by the server), in the app's shape. */
export function fromApiSettings(s: {
  status_ttl_hours: number
  movement_start: string
  judge_tiers: boolean
  movements_public: boolean
}): PublicSettings {
  return {
    statusTtlHours: s.status_ttl_hours,
    movementStart: s.movement_start,
    judgeTiers: s.judge_tiers,
    movementsPublic: s.movements_public,
  }
}
