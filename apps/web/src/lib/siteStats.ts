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
  map: 'Carte',
  list: 'Liste',
  school: 'Fiche établissement',
  report: 'Signaler',
  about: 'À propos',
  data: 'Données',
  other: 'Autre (adresse inconnue)',
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

const PARIS_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})

/** Day of month, hour and minute of an instant, Paris time. */
function parisParts(iso: string): { day: number; hour: number; minute: number } {
  const get = (type: string) =>
    Number(PARIS_PARTS.formatToParts(new Date(iso)).find((p) => p.type === type)?.value ?? 0)
  return { day: get('day'), hour: get('hour'), minute: get('minute') }
}

/**
 * Slots that get a label on the time axis: round times (every 30 min over 2 h, every 4 h over 24 h,
 * midnights over 7 days, the 1st / 6th / 11th... over 30 days, the 1st and 15th over 90 days),
 * not "every 17th point", which gave 06:00, 10:15, 14:30...
 */
export function isMajorTick(iso: string, range: RangeId): boolean {
  const { day, hour, minute } = parisParts(iso)
  switch (range) {
    case '2h':
      return minute % 30 === 0
    case '24h':
      return minute === 0 && hour % 4 === 0
    case '7d':
      return minute === 0 && hour === 0
    case '30d':
      return [1, 6, 11, 16, 21, 26].includes(day)
    case '90d':
      return day === 1 || day === 15
  }
}

/** The slot still running: it holds a fraction of its time, so its low value is not a drop. */
export const isPartialSlot = (iso: string, stepSeconds: number, nowMs: number): boolean =>
  new Date(iso).getTime() + stepSeconds * 1000 > nowMs

/** The API's overview (camelCase, dates as Date) in the shape the dashboard draws. */
export function fromApiOverview(o: {
  live: number
  livePages: Record<string, number>
  todayVisitors: number
  daily: Array<{ day: string; visitors: number; views: number }>
  hourly: Array<{ hour: Date; views: number }>
  pages: Array<{ page: string; views: number }>
  vitals: Array<{
    metric: string
    n: number
    p50: number | null
    p75: number | null
    p95: number | null
    p75Prev: number | null
  }>
}): SiteStats {
  return parseSiteStats({
    live: o.live,
    live_pages: o.livePages,
    today_visitors: o.todayVisitors,
    daily: o.daily,
    hourly: o.hourly.map((h) => ({ hour: h.hour.toISOString(), views: h.views })),
    pages: o.pages,
    vitals: o.vitals.map((v) => ({ ...v, p75_prev: v.p75Prev })),
  })
}

/** The API's series in the shape the charts draw. */
export function fromApiSeries(s: {
  range: string
  stepSeconds: number
  points: Array<{
    t: Date
    views: number
    visitors: number | null
    online: number | null
    lcp: number | null
    inp: number | null
    api: number | null
  }>
  pages: Array<{ page: string; views: number }>
  summary: {
    views: number
    peakOnline: number | null
    peakOnlineAt: Date | null
    lcpP75: number | null
    apiP75: number | null
  }
}): Series {
  return parseSeries({
    range: s.range,
    step_seconds: s.stepSeconds,
    points: s.points.map((p) => ({ ...p, t: p.t.toISOString() })),
    pages: s.pages,
    summary: {
      views: s.summary.views,
      peak_online: s.summary.peakOnline,
      peak_online_at: s.summary.peakOnlineAt?.toISOString() ?? null,
      lcp_p75: s.summary.lcpP75,
      api_p75: s.summary.apiP75,
    },
  })
}
