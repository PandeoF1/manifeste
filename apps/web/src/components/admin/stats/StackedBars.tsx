import { useEffect, useRef, useState } from 'react'
import type { DayBucket, ModelSeries } from '@/lib/aiUsage'
import { compactTokens } from '@/lib/aiUsage'
import { fmtDay, fmtDayLong, fmtInt, niceStep } from '@/lib/donneesFormat'

const PAD_TOP = 10
const PAD_BOTTOM = 26
const PAD_LEFT = 40
const H = 170

/** Real width of the container: the chart is drawn in pixels, the text keeps its size. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/**
 * One bar per day, stacked by series (here: a model). The day's detail is shown above
 * (hover or touch, by default the busiest day); the legend names each colour and the
 * full table is offered for screen readers.
 */
export function StackedBars({
  days,
  series,
  unit,
  title,
}: {
  days: DayBucket[]
  series: ModelSeries[]
  /** What the chart measures, for the alternative text ("tokens d'entrée"). */
  unit: string
  title: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const { ref, width } = useWidth()
  const W = Math.max(260, width || 560)
  const n = days.length
  const first = days[0]
  const last = days[n - 1]
  if (!first || !last) return null
  const max = Math.max(1, ...days.map((d) => d.total))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const innerH = H - PAD_TOP - PAD_BOTTOM
  const y = (v: number) => PAD_TOP + innerH * (1 - v / top)
  const plotW = W - PAD_LEFT
  const col = plotW / n
  const bar = Math.max(3, col * 0.7)
  const peakIndex = days.reduce((best, d, i) => (d.total > (days[best]?.total ?? 0) ? i : best), 0)
  const peak = days[peakIndex] ?? first
  const shownIndex = hover ?? peakIndex
  const shown = days[shownIndex] ?? peak
  // One label every ~70 px: never overlapping dates on a phone.
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 70))))
  const ticks = [0, top / 2, top]

  return (
    <figure className="space-y-2">
      <p className="min-h-[3.25rem] text-sm leading-snug" aria-live="polite">
        <strong className="text-base">{fmtDayLong(shown.day)}</strong>
        <br />
        <span className="tabular-nums">
          <strong>{fmtInt(shown.total)}</strong> {unit}
        </span>
        {shown.total > 0 && (
          <span className="text-muted tabular-nums">
            {' '}
            (
            {series
              .map((s, i) => [s, shown.values[i] ?? 0] as const)
              .filter(([, v]) => v > 0)
              .map(([s, v]) => `${s.label} ${compactTokens(v)}`)
              .join(' · ')}
            )
          </span>
        )}
      </p>
      <div ref={ref}>
        <svg
          width={W}
          height={H}
          className="block touch-pan-y select-none"
          role="img"
          aria-label={`${title}, jour par jour, du ${fmtDay(first.day)} au ${fmtDay(last.day)}. Pic : ${fmtInt(peak.total)} ${unit} le ${fmtDay(peak.day)}.`}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                x2={W}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                strokeDasharray={t === 0 ? undefined : '3 5'}
              />
              <text x={0} y={y(t) + 4} fontSize={12} fill="var(--muted)">
                {compactTokens(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = PAD_LEFT + i * col + (col - bar) / 2
            let acc = 0
            return (
              <g key={d.day}>
                {shownIndex === i && (
                  <rect
                    x={PAD_LEFT + i * col}
                    y={PAD_TOP}
                    width={col}
                    height={innerH}
                    fill="var(--border)"
                    opacity={0.45}
                  />
                )}
                {series.map((s, k) => {
                  const v = d.values[k] ?? 0
                  const y1 = y(acc)
                  acc += v
                  const y2 = y(acc)
                  // A hairline in the background colour separates the stacked segments.
                  return v > 0 ? (
                    <rect
                      key={s.key}
                      x={x}
                      y={y2}
                      width={bar}
                      height={Math.max(1, y1 - y2)}
                      fill={s.color}
                      stroke="var(--surface)"
                      strokeWidth={1}
                    />
                  ) : null
                })}
                {i % labelEvery === 0 && (
                  <text
                    x={x + bar / 2}
                    y={H - 8}
                    fontSize={11}
                    textAnchor="middle"
                    fill="var(--muted)"
                  >
                    {fmtDay(d.day)}
                  </text>
                )}
                <rect
                  x={PAD_LEFT + i * col}
                  y={0}
                  width={col}
                  height={H}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              </g>
            )
          })}
        </svg>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="size-3 rounded-sm"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            {s.label}
          </span>
        ))}
      </figcaption>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Voir le tableau</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="pr-3 font-normal">Jour</th>
                {series.map((s) => (
                  <th key={s.key} className="pr-3 font-normal">
                    {s.label}
                  </th>
                ))}
                <th className="font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="pr-3">{fmtDay(d.day)}</td>
                  {series.map((s, k) => (
                    <td key={s.key} className="pr-3">
                      {fmtInt(d.values[k] ?? 0)}
                    </td>
                  ))}
                  <td>{fmtInt(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
