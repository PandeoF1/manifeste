// Statuts et règles d'expiration, partagés entre le front et les Edge Functions.
export const REPORT_STATUSES = ['bloque', 'filtrant', 'leve'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const STATUS_LABELS: Record<ReportStatus, string> = {
  bloque: 'Bloqué',
  filtrant: 'Barrage filtrant',
  leve: 'Levé',
}

export const DEFAULT_STATUS_TTL_HOURS = 5

/** Un statut expire sans nouveau signal validé depuis `ttlHours`. */
export function isStatusExpired(
  lastSignalAt: Date,
  now: Date = new Date(),
  ttlHours: number = DEFAULT_STATUS_TTL_HOURS,
): boolean {
  return now.getTime() - lastSignalAt.getTime() >= ttlHours * 3_600_000
}

/** "il y a 3 min", "il y a 2 h", ... */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000))
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  return `il y a ${days} j`
}
