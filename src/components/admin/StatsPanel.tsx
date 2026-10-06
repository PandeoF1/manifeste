import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, CheckCircle2, AlertTriangle, XCircle, ArrowDown, ArrowUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
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

const dayFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
})
const shortDayFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'numeric',
  timeZone: 'Europe/Paris',
})
const hourFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', timeZone: 'Europe/Paris' })
const nf = new Intl.NumberFormat('fr-FR')

/** Statistiques anonymes du site : en ligne, visiteurs uniques, pages vues, performances. */
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
  const last7 = s.daily.slice(-8, -1)
  const avg7 = last7.length ? last7.reduce((a, d) => a + d.visitors, 0) / last7.length : 0
  const totalPages = s.pages.reduce((a, p) => a + p.views, 0)

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
          label="Visiteurs / jour (moy. 7 j)"
          value={Math.round(avg7)}
          hint={
            avg7 > 0 && today
              ? `${today.visitors >= avg7 ? '+' : ''}${Math.round(((today.visitors - avg7) / avg7) * 100)} % aujourd'hui`
              : undefined
          }
        />
      </section>

      <section className="card p-4" aria-labelledby="chart-daily">
        <h2 id="chart-daily" className="font-semibold">
          Visiteurs uniques par jour
        </h2>
        <p className="text-xs text-muted">30 derniers jours, survole une barre pour le détail</p>
        <BarChart
          data={s.daily.map((d, i) => ({
            key: d.day,
            value: d.visitors,
            axis:
              i % 5 === 4 || i === s.daily.length - 1 ? shortDayFmt.format(new Date(d.day)) : '',
            title: dayFmt.format(new Date(`${d.day}T12:00:00Z`)),
            lines: [
              `${nf.format(d.visitors)} visiteurs uniques`,
              `${nf.format(d.views)} pages vues`,
            ],
          }))}
          unit="visiteurs"
        />
        <DataTable
          caption="Visiteurs uniques et pages vues par jour"
          head={['Jour', 'Visiteurs uniques', 'Pages vues']}
          rows={s.daily.map((d) => [
            dayFmt.format(new Date(`${d.day}T12:00:00Z`)),
            nf.format(d.visitors),
            nf.format(d.views),
          ])}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="card p-4" aria-labelledby="chart-hourly">
          <h2 id="chart-hourly" className="font-semibold">
            Pages vues par heure
          </h2>
          <p className="text-xs text-muted">Dernières 24 h (heure de Paris)</p>
          <BarChart
            data={s.hourly.map((h, i) => ({
              key: h.hour,
              value: h.views,
              axis:
                i % 4 === 3 || i === s.hourly.length - 1 ? hourFmt.format(new Date(h.hour)) : '',
              title: `${hourFmt.format(new Date(h.hour))} – ${hourFmt.format(new Date(Date.parse(h.hour) + 3_600_000))}`,
              lines: [`${nf.format(h.views)} pages vues`],
            }))}
            unit="pages vues"
          />
        </section>

        <section className="card p-4" aria-labelledby="pages-split">
          <h2 id="pages-split" className="font-semibold">
            Pages consultées
          </h2>
          <p className="text-xs text-muted">Dernières 24 h</p>
          <ul className="mt-3 space-y-2.5">
            {s.pages.length === 0 && <li className="text-sm text-muted">Pas encore de visite.</li>}
            {s.pages.map((p) => {
              const share = totalPages ? p.views / totalPages : 0
              return (
                <li key={p.page}>
                  <div className="flex justify-between text-sm">
                    <span>{PAGE_LABEL[p.page] ?? p.page}</span>
                    <span className="tabular-nums text-muted">
                      {nf.format(p.views)} · {Math.round(share * 100)} %
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-border/60">
                    <div
                      className="h-2 rounded-full bg-chart-1"
                      style={{ width: `${Math.max(share * 100, 1.5)}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

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

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold tracking-wider text-muted uppercase">{label}</div>
      <p className="mt-1 text-4xl font-black tabular-nums">{nf.format(value)}</p>
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
  // Échelle de la jauge : jusqu'à 1,5 × le seuil « lent ».
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
      {/* Jauge : zones bon / à améliorer / lent, plage p50 – p95 et repère p75. */}
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

interface Bar {
  key: string
  value: number
  axis: string
  title: string
  lines: string[]
}

const CH = 160
const PAD_TOP = 8
const AXIS_H = 18

/** Histogramme d'une seule série (pas de légende : le titre la nomme), avec info-bulle. */
function BarChart({ data, unit }: { data: Bar[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const w = 100 / Math.max(data.length, 1)
  const h = CH - PAD_TOP - AXIS_H
  const y = (v: number) => PAD_TOP + h - (v / top) * h
  const hovered = hover != null ? data[hover] : null
  const clip = useId().replace(/:/g, '')

  return (
    <div className="relative mt-3 select-none" onMouseLeave={() => setHover(null)}>
      <div className="flex">
        <div className="relative w-8 shrink-0" style={{ height: CH }} aria-hidden="true">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted tabular-nums"
              style={{ top: y(t) }}
            >
              {nf.format(t)}
            </span>
          ))}
        </div>
        <svg
          className="block min-w-0 flex-1 overflow-visible"
          height={CH}
          role="img"
          aria-label={`Histogramme : ${data.length} barres, maximum ${nf.format(max)} ${unit}`}
        >
          <defs>
            <clipPath id={clip} clipPathUnits="userSpaceOnUse">
              <rect x="0" y="0" width="100%" height={PAD_TOP + h} />
            </clipPath>
          </defs>
          {ticks.map((t) => (
            <line
              key={t}
              x1="0"
              x2="100%"
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeDasharray={t === 0 ? undefined : '2 4'}
            />
          ))}
          {data.map((d, i) => {
            const bh = Math.max((d.value / top) * h, d.value > 0 ? 2 : 0)
            return (
              <g key={d.key}>
                {/* Zone de survol : toute la colonne, plus large que la barre. */}
                <rect
                  x={`${i * w}%`}
                  y={0}
                  width={`${w}%`}
                  height={CH - AXIS_H}
                  fill={hover === i ? 'var(--border)' : 'transparent'}
                  opacity={0.35}
                  onMouseEnter={() => setHover(i)}
                />
                <svg x={`${i * w}%`} width={`${w}%`} y={0} height={CH} overflow="visible">
                  {/* Bout arrondi, base carrée : la barre dépasse sous la ligne de base, rognée. */}
                  <rect
                    x="12%"
                    width="76%"
                    y={PAD_TOP + h - bh}
                    height={bh + 4}
                    rx={Math.min(4, bh / 2)}
                    fill="var(--chart-1)"
                    opacity={hover == null || hover === i ? 1 : 0.55}
                    clipPath={`url(#${clip})`}
                    pointerEvents="none"
                  />
                  {d.axis && (
                    <text x="50%" y={CH - 4} textAnchor="middle" fontSize="10" fill="var(--muted)">
                      {d.axis}
                    </text>
                  )}
                </svg>
              </g>
            )
          })}
        </svg>
      </div>
      {hovered && hover != null && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-xl"
          style={{
            left: `calc(2rem + (100% - 2rem) * ${(hover + 0.5) / data.length})`,
            top: Math.max(y(hovered.value) - 8, 0),
            transform: `translate(${hover > data.length * 0.7 ? '-100%' : hover < data.length * 0.3 ? '0' : '-50%'}, -100%)`,
          }}
        >
          <div className="font-semibold">{hovered.title}</div>
          {hovered.lines.map((l) => (
            <div key={l} className="text-muted tabular-nums">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function niceStep(max: number): number {
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p)
}

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs text-muted">Voir les données</summary>
      <table className="mt-2 w-full text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-muted">
            {head.map((h) => (
              <th key={h} className="py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-border">
              {r.map((c, i) => (
                <td key={i} className="py-1 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
