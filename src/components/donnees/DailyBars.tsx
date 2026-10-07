import { useEffect, useRef, useState } from 'react'
import type { Jour } from '@/queries/donnees'
import { fmtDay, fmtDayLong, fmtInt, niceStep } from '@/lib/donneesFormat'

const PAD_TOP = 10
const PAD_BOTTOM = 26
const PAD_LEFT = 34

/** Largeur réelle du conteneur : le graphique est dessiné en pixels, le texte garde sa taille. */
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
 * Une barre par jour : établissements signalés bloqués ou en barrage filtrant, lycées en bas,
 * facs au-dessus. Le détail du jour s'affiche sous le titre (survol ou toucher) ; le tableau
 * complet est proposé à côté pour les lecteurs d'écran.
 */
export function DailyBars({ jours, compact = false }: { jours: Jour[]; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const { ref, width } = useWidth()
  const W = Math.max(260, width || 640)
  const H = compact ? 170 : 230
  const n = jours.length
  const first = jours[0]
  const last = jours[n - 1]
  if (!first || !last) return null
  const max = Math.max(1, ...jours.map((j) => j.etablissements))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const innerH = H - PAD_TOP - PAD_BOTTOM
  const y = (v: number) => PAD_TOP + innerH * (1 - v / top)
  const plotW = W - PAD_LEFT
  const col = plotW / n
  const bar = Math.max(3, col * 0.7)
  let peakIndex = 0
  jours.forEach((j, i) => {
    if (j.etablissements > (jours[peakIndex]?.etablissements ?? 0)) peakIndex = i
  })
  const peak = jours[peakIndex] ?? first
  const shown = jours[hover ?? peakIndex] ?? peak
  // Une étiquette tous les ~70 px : jamais de dates qui se chevauchent sur un téléphone.
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 70))))
  const ticks = [0, top / 3, (2 * top) / 3, top].map(Math.round)

  return (
    <figure className="space-y-2">
      <p className="min-h-[3.25rem] text-sm leading-snug" aria-live="polite">
        <strong className="text-base">{fmtDayLong(shown.jour)}</strong>
        <br />
        <span className="tabular-nums">
          <strong>{fmtInt(shown.etablissements)}</strong> établissements signalés, dans{' '}
          {fmtInt(shown.departements)} départements
        </span>
        {!compact && (
          <span className="text-muted tabular-nums">
            {' '}
            ({fmtInt(shown.lycees)} lycées, {fmtInt(shown.facs)} facs)
          </span>
        )}
      </p>
      <div ref={ref}>
        <svg
          width={W}
          height={H}
          className="block touch-pan-y select-none"
          role="img"
          aria-label={`Établissements signalés bloqués ou en barrage filtrant, jour par jour, du ${fmtDay(first.jour)} au ${fmtDay(last.jour)}. Pic : ${fmtInt(peak.etablissements)} le ${fmtDay(peak.jour)}.`}
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
                {fmtInt(t)}
              </text>
            </g>
          ))}
          {jours.map((j, i) => {
            const x = PAD_LEFT + i * col + (col - bar) / 2
            const hl = j.lycees
            const hf = j.facs
            const active = (hover ?? peakIndex) === i
            return (
              <g key={j.jour} opacity={active ? 1 : 0.78}>
                <rect
                  x={x}
                  y={y(hl)}
                  width={bar}
                  height={Math.max(0, y(0) - y(hl))}
                  fill="var(--chart-1)"
                />
                <rect
                  x={x}
                  y={y(hl + hf)}
                  width={bar}
                  height={Math.max(0, y(hl) - y(hl + hf))}
                  fill="var(--chart-2)"
                />
                {i % labelEvery === 0 && (
                  <text
                    x={x + bar / 2}
                    y={H - 8}
                    fontSize={11}
                    textAnchor="middle"
                    fill="var(--muted)"
                  >
                    {fmtDay(j.jour)}
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
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: 'var(--chart-1)' }} /> Lycées
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: 'var(--chart-2)' }} /> Facs et
          écoles supérieures
        </span>
      </figcaption>
    </figure>
  )
}
