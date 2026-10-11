import { useQuery } from '@tanstack/react-query'
import { barLabel, fmtDuration } from '@/lib/latency'
import { latencyQuery } from '@/queries/admin'

const LABEL: Record<string, string> = {
  discover: 'Découverte',
  read: 'Lecture',
  extract: 'Extraction',
  store: 'Rattachement / stockage',
}

/** How long each stage takes (last 24 h): median, 95th percentile and a log-scale histogram. */
export function Latency() {
  const data = useQuery(latencyQuery(24))
  if (!data.data) return <div className="mt-3 h-24 animate-pulse rounded bg-bg" />
  if (data.data.length === 0)
    return <p className="mt-3 text-sm text-muted">Aucune durée enregistrée sur 24 h.</p>
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {data.data.map((s) => {
        const peak = Math.max(...s.histogram, 1)
        return (
          <figure key={s.stage} className="card p-3">
            <figcaption className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">{LABEL[s.stage] ?? s.stage}</span>
              <span className="text-muted tabular-nums">
                médiane {fmtDuration(s.p50)} · p95 {fmtDuration(s.p95)} · {s.n} étapes
              </span>
            </figcaption>
            <div
              className="mt-2 flex h-14 items-end gap-0.5"
              role="img"
              aria-label={`Durées de ${LABEL[s.stage] ?? s.stage}, de moins de 10 ms à plus de 5 minutes`}
            >
              {s.histogram.map((n, i) => (
                <div
                  key={i}
                  title={`${barLabel(i)} : ${n}`}
                  className="flex-1 rounded-t bg-filtrant"
                  style={{ height: `${Math.max((n / peak) * 100, n ? 4 : 0)}%` }}
                />
              ))}
            </div>
          </figure>
        )
      })}
    </div>
  )
}
