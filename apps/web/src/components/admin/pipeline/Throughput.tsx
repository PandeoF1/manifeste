import { useQuery } from '@tanstack/react-query'
import { useNow } from '@/lib/useNow'
import { throughputQuery } from '@/queries/admin'

const STAGES = ['discover', 'read', 'extract', 'store'] as const
const LABEL: Record<(typeof STAGES)[number], string> = {
  discover: 'Découverte',
  read: 'Lecture',
  extract: 'Extraction',
  store: 'Rattachement / stockage',
}

/** Events per hour over the last 24 hours, one sparkline per stage; failures are drawn on top in red. */
export function Throughput() {
  const data = useQuery(throughputQuery(24))
  const now = useNow(60_000)
  if (!data.data) return <div className="h-24 animate-pulse rounded bg-bg" />
  const hours = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getTime() - (23 - i) * 3_600_000)
    d.setMinutes(0, 0, 0)
    return d.getTime()
  })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {STAGES.map((stage) => {
        const rows = data.data.filter((r) => r.stage === stage)
        const bucket = (failed: boolean) =>
          hours.map((h) =>
            rows
              .filter(
                (r) => new Date(r.hour).getTime() === h && (r.outcome === 'failed') === failed,
              )
              .reduce((n, r) => n + r.n, 0),
          )
        const ok = bucket(false)
        const bad = bucket(true)
        const max = Math.max(1, ...ok.map((v, i) => v + (bad[i] ?? 0)))
        const sum = ok.reduce((a, b) => a + b, 0)
        return (
          <figure key={stage} className="card p-3">
            <figcaption className="flex items-baseline justify-between text-xs text-muted">
              <span>{LABEL[stage]}</span>
              <span className="tabular-nums">{sum} / 24 h</span>
            </figcaption>
            <svg
              viewBox="0 0 120 32"
              className="mt-1 w-full"
              role="img"
              aria-label={`${LABEL[stage]} : ${sum} événements en 24 heures`}
            >
              {hours.map((h, i) => {
                const a = ((ok[i] ?? 0) / max) * 30
                const b = ((bad[i] ?? 0) / max) * 30
                return (
                  <g key={h}>
                    <rect
                      x={i * 5 + 0.5}
                      y={31 - a - b}
                      width="4"
                      height={a}
                      fill="var(--series-1)"
                    />
                    <rect x={i * 5 + 0.5} y={31 - b} width="4" height={b} fill="var(--poor)" />
                  </g>
                )
              })}
            </svg>
          </figure>
        )
      })}
    </div>
  )
}
