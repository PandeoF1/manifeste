import { useId } from 'react'

export interface TrendPoint {
  /** Libellé complet de la tranche (info-bulle). */
  label: string
  /** Libellé court pour l'axe. */
  axis: string
  value: number | null
}

const H = 132
const PAD_TOP = 10

/**
 * Courbe d'une seule série (le titre la nomme : pas de légende), aire légère, trous pour les
 * valeurs inconnues. Le survol est partagé entre les courbes d'une même période (`hover`).
 */
export function TrendChart({
  points,
  format,
  color = 'var(--chart-1)',
  hover,
  onHover,
  bands,
  ariaLabel,
}: {
  points: TrendPoint[]
  format: (v: number) => string
  color?: string
  hover: number | null
  onHover: (i: number | null) => void
  /** Seuils (ex. Web Vitals) : lignes repères « bon » et « lent ». */
  bands?: { good: number; poor: number }
  ariaLabel: string
}) {
  const gradId = useId().replace(/:/g, '')
  const n = points.length
  const values = points.map((p) => p.value).filter((v): v is number => v != null)
  const rawMax = Math.max(1, ...values, bands ? bands.good : 0)
  const step = niceStep(rawMax)
  const top = Math.ceil(rawMax / step) * step
  const ticks = [0, top / 2, top]
  const x = (i: number) => (n <= 1 ? 500 : (i / (n - 1)) * 1000)
  const y = (v: number) => PAD_TOP + (H - PAD_TOP) * (1 - v / top)

  // Segments continus (une valeur null coupe la courbe).
  const segments: Array<Array<[number, number]>> = []
  let cur: Array<[number, number]> = []
  points.forEach((p, i) => {
    if (p.value == null) {
      if (cur.length) segments.push(cur)
      cur = []
    } else cur.push([x(i), y(p.value)])
  })
  if (cur.length) segments.push(cur)
  const line = (seg: Array<[number, number]>) =>
    seg.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')

  const labelEvery = Math.max(1, Math.ceil(n / 6))
  const hovered = hover != null ? points[hover] : null
  const pct = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)

  return (
    <div className="flex select-none">
      <div className="relative w-10 shrink-0" style={{ height: H }} aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute right-2 -translate-y-1/2 text-[10px] text-muted tabular-nums"
            style={{ top: y(t) }}
          >
            {format(t)}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div
          className="relative"
          style={{ height: H }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1))
            onHover(Math.min(n - 1, Math.max(0, i)))
          }}
          onMouseLeave={() => onHover(null)}
        >
          <svg
            viewBox={`0 0 1000 ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={ariaLabel}
          >
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <line
                key={t}
                x1="0"
                x2="1000"
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeDasharray={t === 0 ? undefined : '3 5'}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {bands && (
              <>
                <line
                  x1="0"
                  x2="1000"
                  y1={y(bands.good)}
                  y2={y(bands.good)}
                  stroke="var(--good)"
                  strokeOpacity="0.6"
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                />
                {bands.poor <= top && (
                  <line
                    x1="0"
                    x2="1000"
                    y1={y(bands.poor)}
                    y2={y(bands.poor)}
                    stroke="var(--poor)"
                    strokeOpacity="0.6"
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </>
            )}
            {segments.map((seg, k) => (
              <g key={k}>
                {seg.length > 1 && (
                  <path
                    d={`${line(seg)} L${seg.at(-1)?.[0]} ${H} L${seg[0]?.[0]} ${H} Z`}
                    fill={`url(#${gradId})`}
                  />
                )}
                <path
                  d={line(seg)}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
          {/* Points isolés (entourés de trous) : sinon invisibles. */}
          {segments
            .filter((s) => s.length === 1)
            .map((s) => (
              <span
                key={`${s[0]?.[0]}`}
                className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${((s[0]?.[0] ?? 0) / 1000) * 100}%`,
                  top: s[0]?.[1],
                  background: color,
                }}
              />
            ))}
          {hover != null && (
            <>
              <span
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-fg/30"
                style={{ left: `${pct(hover)}%` }}
              />
              {hovered?.value != null && (
                <span
                  className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                  style={{ left: `${pct(hover)}%`, top: y(hovered.value), background: color }}
                />
              )}
              <div
                className="pointer-events-none absolute -top-1 z-10 rounded-md border border-border bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-lg"
                style={{
                  left: `${pct(hover)}%`,
                  transform: `translateX(${pct(hover) > 70 ? '-105%' : pct(hover) < 30 ? '5%' : '-50%'})`,
                }}
              >
                <span className="text-muted">{hovered?.label}</span>{' '}
                <span className="font-semibold tabular-nums">
                  {hovered?.value != null ? format(hovered.value) : '–'}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="relative mt-1 h-4" aria-hidden="true">
          {points.map((p, i) => {
            // Une étiquette sur `labelEvery`, plus la dernière (sans chevaucher sa voisine).
            const regular = i % labelEvery === 0 && n - 1 - i >= labelEvery * 0.6
            if (!regular && i !== n - 1) return null
            return (
              <span
                key={i}
                className="absolute text-[10px] whitespace-nowrap text-muted"
                style={{
                  left: `${pct(i)}%`,
                  transform: `translateX(${i === 0 ? '0' : i === n - 1 ? '-100%' : '-50%'})`,
                }}
              >
                {p.axis}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function niceStep(max: number): number {
  const raw = max / 2
  const p = 10 ** Math.floor(Math.log10(raw))
  const k = raw / p
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * p
}
