// Périodes de consultation de la carte et de la liste. « direct » suit status_ttl_hours ;
// les autres remontent dans le temps jusqu'au début du mouvement (réglable dans l'admin).
export const PERIODS = ['direct', '24h', '7j', 'tout'] as const
export type Period = (typeof PERIODS)[number]

export interface PublicSettings {
  statusTtlHours: number
  /** AAAA-MM-JJ */
  movementStart: string
  /** Niveaux du juge allumés : la carte montre à part les mobilisations « pas claires ». */
  judgeTiers: boolean
}

export const DEFAULT_SETTINGS: PublicSettings = {
  statusTtlHours: 5,
  movementStart: '2026-09-14',
  judgeTiers: false,
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

/** Date de début du mouvement, minuit heure de Paris (approximé en UTC+2 hors hiver). */
function movementStartDate(movementStart: string): Date {
  const d = new Date(`${movementStart}T00:00:00+02:00`)
  return Number.isNaN(d.getTime())
    ? new Date(`${DEFAULT_SETTINGS.movementStart}T00:00:00+02:00`)
    : d
}

/** Début de la période ; jamais avant le début du mouvement. */
export function periodSince(period: Period, settings: PublicSettings, now = Date.now()): Date {
  const start = movementStartDate(settings.movementStart)
  const hours = { direct: settings.statusTtlHours, '24h': 24, '7j': 24 * 7, tout: Infinity }[period]
  if (hours === Infinity) return start
  const since = new Date(now - hours * 3_600_000)
  return since < start ? start : since
}

/** Phrase qui décrit la période : « ces 5 dernières heures », « depuis le 14 septembre ». */
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

/** Lecture tolérante de la table app_settings (valeurs texte). */
export function parseSettings(rows: ReadonlyArray<{ key: string; value: string }>): PublicSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value
  const ttl = Number(get('status_ttl_hours'))
  const start = get('movement_start')
  return {
    statusTtlHours: Number.isInteger(ttl) && ttl > 0 ? ttl : DEFAULT_SETTINGS.statusTtlHours,
    movementStart:
      start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : DEFAULT_SETTINGS.movementStart,
    judgeTiers: get('judge_tiers') === 'on',
  }
}
