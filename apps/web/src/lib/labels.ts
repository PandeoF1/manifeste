/** The site's words for each status. All visible text about statuses goes through here. */
import type { ReportStatus } from '@manifeste/core'

/**
 * The red status also covers schools closed or switched to remote classes because of the
 * movement (the About page explains it).
 */
export const STATUS_LABELS: Record<ReportStatus, string> = {
  blocked: 'Bloqué',
  filtering: 'Barrage filtrant',
  lifted: 'Levé',
}

/** The third kind: a gathering or mobilisation, without the entrance being blocked. */
export const MOBILISATION_LABEL = 'Mobilisation signalée'

/** The red status in a sentence, agreed in number: "bloqué", "bloqués". */
export function blockedPhrase(count: number): string {
  return count > 1 ? 'bloqués' : 'bloqué'
}

/** Red and filtering together (what the curves and the key figures count). */
export const ACTIVE_PHRASE = 'bloqués ou en barrage filtrant'

/** The status in a sentence (sharing, summary). */
export const STATUS_SENTENCE: Record<ReportStatus, string> = {
  blocked: 'bloqué',
  filtering: 'barrage filtrant',
  lifted: 'blocus levé',
}

/** "il y a 3 min", "il y a 2 h", ... */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000))
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}

/** Where a report comes from, in the site's words. */
export const ORIGIN_LABELS: Record<'press' | 'union' | 'aggregator' | 'on_site', string> = {
  press: 'Presse',
  union: 'Syndicat',
  on_site: 'Sur place, vérifié',
  aggregator: 'Collecte automatique',
}
