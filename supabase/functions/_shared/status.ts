// Statuts et règles d'expiration, partagés entre le front et les Edge Functions.
export const REPORT_STATUSES = ['bloque', 'filtrant', 'leve'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

/**
 * Mots du site pour chaque statut. Le statut rouge recouvre aussi les établissements fermés ou
 * passés à distance à cause du mouvement (la page À propos l'explique). Tout le texte du site passe par ici.
 */
export const STATUS_LABELS: Record<ReportStatus, string> = {
  bloque: 'Bloqué',
  filtrant: 'Barrage filtrant',
  leve: 'Levé',
}

/** Le statut rouge dans une phrase, accordé au nombre : « bloqué », « bloqués ». */
export function blockedPhrase(count: number): string {
  return count > 1 ? 'bloqués' : 'bloqué'
}

/** Rouge et barrage filtrant ensemble (ce que comptent les courbes et les chiffres clés). */
export const ACTIVE_PHRASE = 'bloqués ou en barrage filtrant'

/** Le statut dans une phrase (partage, résumé). */
export const STATUS_SENTENCE: Record<ReportStatus, string> = {
  bloque: 'bloqué',
  filtrant: 'barrage filtrant',
  leve: 'blocus levé',
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
