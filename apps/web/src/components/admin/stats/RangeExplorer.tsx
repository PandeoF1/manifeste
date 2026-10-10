import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import {
  METRIC_INFO,
  PAGE_LABEL,
  RANGES,
  formatAxis,
  formatBucket,
  formatMetric,
  parseSeries,
  type RangeId,
} from '@/lib/siteStats'
import { TrendChart } from './TrendChart'

const nf = new Intl.NumberFormat('fr-FR')
const fmtInt = (v: number) => nf.format(Math.round(v))

const seriesQuery = (range: RangeId) => ({
  queryKey: [...queryKeys.admin.all, 'site-series', range],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('admin_analytics_series', { p_range: range })
    if (error) throw error
    return parseSeries(data)
  },
  // Short periods move fast; long ones hardly at all.
  refetchInterval: range === '2h' ? 15_000 : range === '24h' ? 60_000 : 300_000,
  placeholderData: keepPreviousData,
})

const STEP_LABEL: Record<RangeId, string> = {
  '2h': 'tranches de 5 min',
  '24h': 'tranches de 15 min',
  '7d': 'par heure',
  '30d': 'par jour',
  '90d': 'par jour',
}

/** Zoom per period: synchronised curves (shared hover) and detail per page. */
export function RangeExplorer() {
  const [range, setRange] = useState<RangeId>('24h')
  const [hover, setHover] = useState<number | null>(null)
  const q = useQuery(seriesQuery(range))
  const s = q.data
  const daily = (s?.stepSeconds ?? 0) >= 86_400
  const pts = (pick: (p: NonNullable<typeof s>['points'][number]) => number | null) =>
    s?.points.map((p) => ({
      label: formatBucket(p.t, s.stepSeconds, true),
      axis: formatAxis(p.t, s.stepSeconds),
      value: pick(p),
    })) ?? []
  const totalPages = s?.pages.reduce((a, p) => a + p.views, 0) ?? 0
  const visitorsTotal = s?.points.reduce((a, p) => a + (p.visitors ?? 0), 0) ?? 0

  return (
    <section className="card space-y-5 p-4" aria-labelledby="explorer-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="explorer-title" className="font-semibold">
            Évolution
          </h2>
          <p className="text-xs text-muted">
            {STEP_LABEL[range]} · heure de Paris · survole une courbe pour le détail
          </p>
        </div>
        <div
          role="group"
          aria-label="Période"
          className="flex rounded-lg border border-border bg-bg p-0.5 text-sm"
        >
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              onClick={() => {
                setHover(null)
                setRange(r.id)
              }}
              className="min-h-9 rounded-md px-3 aria-pressed:bg-surface aria-pressed:font-semibold aria-pressed:shadow"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {q.isError && (
        <p className="text-sm text-poor" role="alert">
          Impossible de charger la période : {q.error.message}
        </p>
      )}
      {!s && !q.isError && <div className="h-72 animate-pulse rounded-lg bg-bg" />}

      {s && (
        <div className={q.isFetching && q.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary label="Pages vues" value={fmtInt(s.summary.views)} />
            <Summary
              label={daily ? 'Visiteurs (somme des jours)' : 'Nouveaux visiteurs'}
              value={fmtInt(visitorsTotal)}
              hint={
                daily
                  ? undefined
                  : 'premiers passages du jour, recomptés chaque jour · historique depuis la mise en place'
              }
            />
            <Summary
              label="Pic en ligne"
              value={s.summary.peakOnline != null ? fmtInt(s.summary.peakOnline) : '–'}
              hint={
                s.summary.peakOnlineAt
                  ? formatBucket(s.summary.peakOnlineAt, 60, range !== '2h')
                  : 'relevé chaque minute'
              }
            />
            <Summary
              label="Affichage (LCP p75)"
              value={formatMetric('LCP', s.summary.lcpP75)}
              hint={`base : ${formatMetric('API', s.summary.apiP75)}`}
            />
          </dl>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <Chart title="Pages vues">
              <TrendChart
                points={pts((p) => p.views)}
                format={fmtInt}
                hover={hover}
                onHover={setHover}
                ariaLabel={`Pages vues, ${STEP_LABEL[range]}`}
              />
            </Chart>
            <Chart title={daily ? 'Visiteurs uniques par jour' : 'Nouveaux visiteurs'}>
              <TrendChart
                points={pts((p) => p.visitors)}
                format={fmtInt}
                color="var(--good)"
                hover={hover}
                onHover={setHover}
                ariaLabel="Visiteurs"
              />
            </Chart>
            <Chart title="En ligne (pic de la tranche)">
              <TrendChart
                points={pts((p) => p.online)}
                format={fmtInt}
                color="var(--warn)"
                hover={hover}
                onHover={setHover}
                ariaLabel="Personnes en ligne"
              />
            </Chart>
            <Chart title="Affichage principal (LCP, p75)">
              <TrendChart
                points={pts((p) => p.lcp)}
                format={(v) => formatMetric('LCP', v)}
                color="var(--chart-1)"
                bands={{ good: METRIC_INFO.LCP.good, poor: METRIC_INFO.LCP.poor }}
                hover={hover}
                onHover={setHover}
                ariaLabel="LCP au 75e centile"
              />
            </Chart>
            <Chart title="Latence de la base (p75)">
              <TrendChart
                points={pts((p) => p.api)}
                format={(v) => formatMetric('API', v)}
                color="var(--chart-1)"
                bands={{ good: METRIC_INFO.API.good, poor: METRIC_INFO.API.poor }}
                hover={hover}
                onHover={setHover}
                ariaLabel="Latence de la base au 75e centile"
              />
            </Chart>
            <Chart title="Pages consultées">
              <ul className="space-y-2.5">
                {s.pages.length === 0 && (
                  <li className="text-sm text-muted">Pas de visite sur la période.</li>
                )}
                {s.pages.map((p) => {
                  const share = totalPages ? p.views / totalPages : 0
                  return (
                    <li key={p.page}>
                      <div className="flex justify-between text-sm">
                        <span>{PAGE_LABEL[p.page] ?? p.page}</span>
                        <span className="text-muted tabular-nums">
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
            </Chart>
          </div>

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-xs text-muted">Voir les données</summary>
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <caption className="sr-only">Données de la période</caption>
                <thead className="sticky top-0 bg-surface text-muted">
                  <tr>
                    <th className="py-1 font-medium">Tranche</th>
                    <th className="py-1 font-medium">Pages vues</th>
                    <th className="py-1 font-medium">Visiteurs</th>
                    <th className="py-1 font-medium">En ligne (pic)</th>
                    <th className="py-1 font-medium">LCP p75</th>
                    <th className="py-1 font-medium">Base p75</th>
                  </tr>
                </thead>
                <tbody>
                  {[...s.points].reverse().map((p) => (
                    <tr key={p.t} className="border-t border-border">
                      <td className="py-1">{formatBucket(p.t, s.stepSeconds, true)}</td>
                      <td className="py-1">{nf.format(p.views)}</td>
                      <td className="py-1">{p.visitors ?? '–'}</td>
                      <td className="py-1">{p.online ?? '–'}</td>
                      <td className="py-1">{formatMetric('LCP', p.lcp)}</td>
                      <td className="py-1">{formatMetric('API', p.api)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  )
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-2xl font-black tabular-nums">{value}</dd>
      {hint && <dd className="text-[11px] text-muted">{hint}</dd>}
    </div>
  )
}

function Chart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}
