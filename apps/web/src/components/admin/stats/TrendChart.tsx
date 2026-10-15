import { useId } from 'react'

export interface TrendPoint {
  /** Full label of the slot (tooltip). */
  label: string
  /** Short label for the axis. */
  axis: string
  value: number | null
  /** Gets a label on the axis (a round time). */
  major?: boolean
  /** The slot is still running: drawn dashed, not as a drop. */
  partial?: boolean
}

const H = 132
const PAD_TOP = 10

/**
 * Curve of a single series (the title names it: no legend), light area, gaps for
 * unknown values. Hover is shared between the curves of the same period (`hover`).
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
  /** Thresholds (e.g. Web Vitals): "good" and "slow" reference lines. */
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

  // Continuous segments (a null value breaks the curve).
  const segments: Array<Array<[number, number]>> = []
  let cur: Array<[number, number]> = []
  points.forEach((p, i) => {
    if (p.value == null) {
      if (cur.length) segments.push(cur)
      cur = []
    } else cur.push([x(i), y(p.value)])
  })
  if (cur.length) segments.push(cur)
  // The running slot holds only part of its time: the last stretch is dashed, not a plunge.
  let tail: Array<[number, number]> | null = null
  const lastPoint = points[n - 1]
  if (lastPoint?.partial && lastPoint.value != null) {
    const seg = segments.at(-1)
    if (seg && seg.length > 1) {
      tail = [seg[seg.length - 2] as [number, number], seg[seg.length - 1] as [number, number]]
      seg.pop()
    }
  }
  const line = (seg: Array<[number, number]>) =>
    seg.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')

  const hasMajor = points.some((p) => p.major)
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
            {tail && (
              <path
                d={line(tail)}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeDasharray="4 5"
                strokeOpacity="0.7"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {/* Isolated points (surrounded by gaps): otherwise invisible. */}
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
                <span className="text-muted">
                  {hovered?.label}
                  {hovered?.partial ? ' (en cours)' : ''}
                </span>{' '}
                <span className="font-semibold tabular-nums">
                  {hovered?.value != null ? format(hovered.value) : '–'}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="relative mt-1 h-4" aria-hidden="true">
          {points.map((p, i) => {
            // Round times only. If none is marked (an unexpected period), fall back to evenly spaced.
            if (hasMajor ? !p.major : !(i % labelEvery === 0 && n - 1 - i >= labelEvery * 0.6))
              return null
            const edge = pct(i)
            return (
              <span
                key={i}
                className="absolute text-[10px] whitespace-nowrap text-muted"
                style={{
                  left: `${edge}%`,
                  transform: `translateX(${edge < 4 ? '0' : edge > 96 ? '-100%' : '-50%'})`,
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
