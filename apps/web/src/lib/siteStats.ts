// "Stats" dashboard: reads admin_analytics and the Web Vitals thresholds.

export interface DailyPoint {
  day: string
  visitors: number
  views: number
}
export interface HourlyPoint {
  hour: string
  views: number
}
export interface VitalStat {
  metric: Metric
  n: number
  p50: number | null
  p75: number | null
  p95: number | null
  p75_prev: number | null
}
export interface SiteStats {
  live: number
  live_pages: Record<string, number>
  today_visitors: number
  daily: DailyPoint[]
  hourly: HourlyPoint[]
  pages: Array<{ page: string; views: number }>
  vitals: VitalStat[]
}

export type Metric = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB' | 'API'
export type Rating = 'good' | 'warn' | 'poor'

/** Google's "good" / "needs improvement" thresholds (Web Vitals); API: our own. */
export const METRIC_INFO: Record<
  Metric,
  { label: string; help: string; good: number; poor: number; unit: 'ms' | '' }
> = {
  LCP: {
    label: 'Affichage principal',
    help: 'LCP : temps avant que le plus gros élément (la carte) soit affiché.',
    good: 2500,
    poor: 4000,
    unit: 'ms',
  },
  INP: {
    label: 'Réactivité',
    help: 'INP : délai entre un tap/clic et la réponse visible.',
    good: 200,
    poor: 500,
    unit: 'ms',
  },
  CLS: {
    label: 'Stabilité',
    help: 'CLS : décalages de mise en page pendant le chargement (sans unité).',
    good: 0.1,
    poor: 0.25,
    unit: '',
  },
  FCP: {
    label: 'Premier affichage',
    help: 'FCP : temps avant le premier élément affiché.',
    good: 1800,
    poor: 3000,
    unit: 'ms',
  },
  TTFB: {
    label: 'Réponse du serveur',
    help: 'TTFB : temps avant le premier octet de la page (Vercel).',
    good: 800,
    poor: 1800,
    unit: 'ms',
  },
  API: {
    label: 'Latence de la base',
    help: 'Temps jusqu’au premier octet des lectures Supabase vues par les visiteurs.',
    good: 800,
    poor: 2000,
    unit: 'ms',
  },
}
export const METRIC_ORDER: Metric[] = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB', 'API']

export function rate(metric: Metric, value: number): Rating {
  const { good, poor } = METRIC_INFO[metric]
  return value <= good ? 'good' : value <= poor ? 'warn' : 'poor'
}

export const RATING_LABEL: Record<Rating, string> = {
  good: 'Bon',
  warn: 'À améliorer',
  poor: 'Lent',
}

export function formatMetric(metric: Metric, value: number | null): string {
  if (value == null) return '-'
  if (METRIC_INFO[metric].unit === '') return value.toFixed(2).replace('.', ',')
  return value >= 1000
    ? `${(value / 1000).toFixed(2).replace('.', ',')} s`
    : `${Math.round(value)} ms`
}

export const PAGE_LABEL: Record<string, string> = {
  carte: 'Carte',
  liste: 'Liste',
  lycee: 'Fiche établissement',
  signaler: 'Signaler',
  'a-propos': 'À propos',
  donnees: 'Données',
  autre: 'Autre (adresse inconnue)',
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const numOrNull = (v: unknown) => (v == null ? null : Number(v))

/** Validates the JSON response (loose types on the database side: numbers sometimes as text). */
export function parseSiteStats(raw: unknown): SiteStats {
  const r = (raw ?? {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  return {
    live: num(r.live),
    live_pages: Object.fromEntries(
      Object.entries((r.live_pages ?? {}) as Record<string, unknown>).map(([k, v]) => [k, num(v)]),
    ),
    today_visitors: num(r.today_visitors),
    daily: arr(r.daily).map((d) => ({
      day: String(d.day),
      visitors: num(d.visitors),
      views: num(d.views),
    })),
    hourly: arr(r.hourly).map((h) => ({ hour: String(h.hour), views: num(h.views) })),
    pages: arr(r.pages).map((p) => ({ page: String(p.page), views: num(p.views) })),
    vitals: arr(r.vitals)
      .filter((v) => (METRIC_ORDER as string[]).includes(String(v.metric)))
      .map((v) => ({
        metric: v.metric as Metric,
        n: num(v.n),
        p50: numOrNull(v.p50),
        p75: numOrNull(v.p75),
        p95: numOrNull(v.p95),
        p75_prev: numOrNull(v.p75_prev),
      })),
  }
}

/** Zoom periods (slots: 5 min, 15 min, 1 h, 1 day). */
export const RANGES = [
  { id: '2h', label: '2 h' },
  { id: '24h', label: '24 h' },
  { id: '7d', label: '7 j' },
  { id: '30d', label: '30 j' },
  { id: '90d', label: '90 j' },
] as const
export type RangeId = (typeof RANGES)[number]['id']

export interface SeriesPoint {
  t: string
  views: number
  /** New visitors of the slot (intraday) or unique visitors of the day; null = unknown. */
  visitors: number | null
  online: number | null
  lcp: number | null
  inp: number | null
  api: number | null
}
export interface Series {
  range: RangeId
  stepSeconds: number
  points: SeriesPoint[]
  pages: Array<{ page: string; views: number }>
  summary: {
    views: number
    peakOnline: number | null
    peakOnlineAt: string | null
    lcpP75: number | null
    apiP75: number | null
  }
}

export function parseSeries(raw: unknown): Series {
  const r = (raw ?? {}) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
  const s = (r.summary ?? {}) as Record<string, unknown>
  const range = RANGES.some((x) => x.id === r.range) ? (r.range as RangeId) : '24h'
  return {
    range,
    stepSeconds: num(r.step_seconds) || 900,
    points: arr(r.points).map((p) => ({
      t: String(p.t),
      views: num(p.views),
      visitors: numOrNull(p.visitors),
      online: numOrNull(p.online),
      lcp: numOrNull(p.lcp),
      inp: numOrNull(p.inp),
      api: numOrNull(p.api),
    })),
    pages: arr(r.pages).map((p) => ({ page: String(p.page), views: num(p.views) })),
    summary: {
      views: num(s.views),
      peakOnline: numOrNull(s.peak_online),
      peakOnlineAt: s.peak_online_at == null ? null : String(s.peak_online_at),
      lcpP75: numOrNull(s.lcp_p75),
      apiP75: numOrNull(s.api_p75),
    },
  }
}

/** Label of a slot according to its duration (Paris time). */
export function formatBucket(iso: string, stepSeconds: number, long = false): string {
  const d = new Date(iso)
  const tz = 'Europe/Paris'
  if (stepSeconds >= 86_400)
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
      ...(long ? { weekday: 'short' } : {}),
    }).format(d)
  const time = new Intl.DateTimeFormat('fr-FR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
  if (stepSeconds >= 3_600 || long) {
    const day = new Intl.DateTimeFormat('fr-FR', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
    }).format(d)
    return `${day} ${time}`
  }
  return time
}

/** Short axis label: hour (sub-hourly), day (hourly or daily). */
export function formatAxis(iso: string, stepSeconds: number): string {
  const d = new Date(iso)
  const tz = 'Europe/Paris'
  if (stepSeconds < 3_600)
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  if (stepSeconds < 86_400)
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
    }).format(d)
  return new Intl.DateTimeFormat('fr-FR', { timeZone: tz, day: 'numeric', month: 'short' }).format(
    d,
  )
}
