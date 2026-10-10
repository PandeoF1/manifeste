import { useQuery } from '@tanstack/react-query'
import { Activity, CheckCircle2, AlertTriangle, XCircle, ArrowDown, ArrowUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { RangeExplorer } from './stats/RangeExplorer'
import { queryKeys } from '@/lib/queryKeys'
import {
  METRIC_INFO,
  METRIC_ORDER,
  PAGE_LABEL,
  RATING_LABEL,
  formatMetric,
  parseSiteStats,
  rate,
  type Rating,
  type VitalStat,
} from '@/lib/siteStats'

const statsQuery = {
  queryKey: [...queryKeys.admin.all, 'site-stats'],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('admin_analytics', { p_days: 30 })
    if (error) throw error
    return parseSiteStats(data)
  },
  refetchInterval: 10_000,
}

const nf = new Intl.NumberFormat('fr-FR')

/** Anonymous site statistics: online, unique visitors, page views, performance. */
export function StatsPanel() {
  const stats = useQuery(statsQuery)
  if (stats.isPending) return <div className="mt-4 h-64 animate-pulse rounded-xl bg-surface" />
  if (stats.isError)
    return (
      <p className="mt-4 text-sm text-poor" role="alert">
        Impossible de charger les statistiques : {stats.error.message}
      </p>
    )
  const s = stats.data
  const today = s.daily.at(-1)
  // Average of the previous 7 days that have data (no false "0" at launch).
  const past = s.daily.slice(-8, -1).filter((d) => d.visitors > 0)
  const avg7 = past.length ? past.reduce((a, d) => a + d.visitors, 0) / past.length : null

  return (
    <div className="mt-4 space-y-6">
      <p className="text-sm text-muted">
        Statistiques maison et anonymes : aucun cookie, aucun service tiers. Les visiteurs uniques
        reposent sur une empreinte du jour (IP + sel détruit chaque nuit), jamais conservée au-delà
        de la journée. Rafraîchi toutes les 10 s.
      </p>

      <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card relative overflow-hidden p-4">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted uppercase">
            <span className="relative flex size-2.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-good" />
            </span>
            En ligne
          </div>
          <p className="mt-1 text-4xl font-black tabular-nums">{nf.format(s.live)}</p>
          <p className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
            {Object.entries(s.live_pages)
              .sort((a, b) => b[1] - a[1])
              .map(([page, n]) => (
                <span key={page} className="rounded-full border border-border px-2 py-0.5">
                  {PAGE_LABEL[page] ?? page} {n}
                </span>
              ))}
            {s.live === 0 && 'Personne pour l’instant'}
          </p>
        </div>
        <Tile label="Visiteurs uniques aujourd'hui" value={s.today_visitors} />
        <Tile label="Pages vues aujourd'hui" value={today?.views ?? 0} />
        <Tile
          label={`Visiteurs / jour (moy. ${past.length || 7} j)`}
          value={avg7 == null ? '–' : Math.round(avg7)}
          // No percentage: the current day is incomplete, comparing it with a full day
          // would always show a misleading drop.
          hint={
            avg7 == null
              ? 'pas encore d’historique'
              : `${past.length} jour${past.length > 1 ? 's' : ''} de données · aujourd'hui encore en cours`
          }
        />
      </section>

      <RangeExplorer />

      <section aria-labelledby="perf-title">
        <h2 id="perf-title" className="flex items-center gap-2 font-semibold">
          <Activity size={18} aria-hidden="true" /> Performances vues par les visiteurs
        </h2>
        <p className="text-xs text-muted">
          75e centile sur 24 h (3 visiteurs sur 4 font mieux), comparé aux 6 jours précédents.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METRIC_ORDER.map((m) => (
            <VitalCard key={m} stat={s.vitals.find((v) => v.metric === m)} metric={m} />
          ))}
        </div>
      </section>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold tracking-wider text-muted uppercase">{label}</div>
      <p className="mt-1 text-4xl font-black tabular-nums">
        {typeof value === 'number' ? nf.format(value) : value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

const RATING_ICON: Record<Rating, typeof CheckCircle2> = {
  good: CheckCircle2,
  warn: AlertTriangle,
  poor: XCircle,
}
const RATING_CLASS: Record<Rating, string> = {
  good: 'text-good',
  warn: 'text-warn',
  poor: 'text-poor',
}

function VitalCard({ metric, stat }: { metric: VitalStat['metric']; stat?: VitalStat }) {
  const info = METRIC_INFO[metric]
  const p75 = stat?.p75 ?? null
  const rating = p75 != null ? rate(metric, p75) : null
  const Icon = rating ? RATING_ICON[rating] : null
  // Gauge scale: up to 1.5 × the "slow" threshold.
  const max = info.poor * 1.5
  const pos = (v: number | null) => `${Math.min(((v ?? 0) / max) * 100, 100)}%`
  const delta = p75 != null && stat?.p75_prev ? p75 - stat.p75_prev : null
  return (
    <div className="card p-4" title={info.help}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{info.label}</div>
          <div className="text-xs text-muted">{metric}</div>
        </div>
        {rating && Icon && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold ${RATING_CLASS[rating]}`}
          >
            <Icon size={14} aria-hidden="true" /> {RATING_LABEL[rating]}
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-black tabular-nums">{formatMetric(metric, p75)}</p>
      <p className="text-xs text-muted">
        {stat?.n ? `${nf.format(stat.n)} mesures` : 'Pas encore de mesure'}
        {delta != null && Math.abs(delta) > (info.unit ? 5 : 0.005) && (
          <span className="ml-2 inline-flex items-center gap-0.5">
            {delta < 0 ? (
              <ArrowDown size={12} aria-hidden="true" />
            ) : (
              <ArrowUp size={12} aria-hidden="true" />
            )}
            {formatMetric(metric, Math.abs(delta))} vs 7 j
          </span>
        )}
      </p>
      {/* Gauge: good / needs improvement / slow zones, p50 – p95 range and p75 marker. */}
      <div className="relative mt-3 h-2" aria-hidden="true">
        <div className="absolute inset-0 flex gap-0.5 overflow-hidden rounded-full opacity-30">
          <div className="h-full bg-good" style={{ width: pos(info.good) }} />
          <div
            className="h-full bg-warn"
            style={{ width: `calc(${pos(info.poor)} - ${pos(info.good)})` }}
          />
          <div className="h-full flex-1 bg-poor" />
        </div>
        {stat?.p50 != null && stat.p95 != null && (
          <div
            className="absolute top-0.5 h-1 rounded-full bg-fg opacity-40"
            style={{ left: pos(stat.p50), width: `calc(${pos(stat.p95)} - ${pos(stat.p50)})` }}
          />
        )}
        {p75 != null && (
          <div
            className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-fg ring-2 ring-surface"
            style={{ left: pos(p75) }}
          />
        )}
      </div>
      {stat?.p50 != null && (
        <p className="mt-2 text-[11px] text-muted tabular-nums">
          médiane {formatMetric(metric, stat.p50)} · p95 {formatMetric(metric, stat.p95)}
        </p>
      )}
    </div>
  )
}
