// Tableau de bord « Stats » : lecture de admin_analytics et seuils des Web Vitals.

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

/** Seuils « bon » / « à améliorer » de Google (Web Vitals) ; API : les nôtres. */
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
    good: 300,
    poor: 1000,
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
  lycee: 'Fiche lycée',
  signaler: 'Signaler',
  'a-propos': 'À propos',
  autre: 'Autre',
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const numOrNull = (v: unknown) => (v == null ? null : Number(v))

/** Valide la réponse JSON (types souples côté base : nombres parfois en texte). */
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
