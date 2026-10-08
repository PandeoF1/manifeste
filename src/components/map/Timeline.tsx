import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Pause, Play } from 'lucide-react'
import {
  PLAY_SPEEDS,
  TIMELINE_RANGES,
  TIMELINE_RANGE_LABELS,
  advance,
  bucketSize,
  bucketize,
  fmtAgo,
  fmtMoment,
  fmtTick,
  type TimelineData,
  type TimelineRange,
} from '@/lib/timeline'

const HOUR = 3_600_000
const TICKS = 5

interface Props {
  data: TimelineData | undefined
  isPending: boolean
  isError: boolean
  /** Début et fin de la frise (millisecondes). */
  from: number
  to: number
  /** Instant affiché sur la carte. */
  at: number
  /** `commit` : le mouvement est fini (on peut l'écrire dans l'adresse). */
  onAtChange: (ms: number, commit: boolean) => void
  range: TimelineRange
  onRangeChange: (range: TimelineRange) => void
  /** Un signalement reste affiché cette durée (heures). */
  hours: number
  hourOptions: number[]
  onHoursChange: (hours: number) => void
  onExit: () => void
}

/**
 * Frise du mode « Historique » : histogramme des signalements dans le temps, curseur pour
 * remonter la carte à n'importe quel instant, et lecture automatique.
 */
export function Timeline({
  data,
  isPending,
  isError,
  from,
  to,
  at,
  onAtChange,
  range,
  onRangeChange,
  hours,
  hourOptions,
  onHoursChange,
  onExit,
}: Props) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(PLAY_SPEEDS[0])
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const span = Math.max(1, to - from)
  const size = bucketSize(span)

  // Valeurs courantes pour la boucle de lecture (qui ne doit pas redémarrer à chaque image).
  const live = useRef({ at, from, to, speed, onAtChange })
  useEffect(() => {
    live.current = { at, from, to, speed, onAtChange }
  })

  useEffect(() => {
    if (!playing) return
    const start = live.current
    // Lecture lancée au bout de la frise : on repart du début.
    let pos = start.at >= start.to - 60_000 ? start.from : start.at
    let last = performance.now()
    let lastEmit = 0
    let raf = 0
    start.onAtChange(pos, false)
    const tick = (now: number) => {
      const cur = live.current
      pos = advance(pos, now - last, cur.from, cur.to, cur.speed)
      last = now
      if (pos >= cur.to) {
        cur.onAtChange(cur.to, true)
        setPlaying(false)
        return
      }
      // La carte se redessine ~7 fois par seconde : assez fluide, sans saturer MapLibre.
      if (now - lastEmit >= 140) {
        lastEmit = now
        cur.onAtChange(pos, false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const buckets = useMemo(
    () => (data ? bucketize(data.events, from, to, size) : []),
    [data, from, to, size],
  )
  const max = useMemo(() => Math.max(1, ...buckets.map((b) => b.total)), [buckets])

  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - from) / span) * 100))
  const atPct = pct(at)
  const windowStart = pct(at - hours * HOUR)

  const pause = () => {
    setPlaying(false)
    onAtChange(at, true)
  }

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return at
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return from + f * span
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    setPlaying(false)
    onAtChange(fromPointer(e), false)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onAtChange(fromPointer(e), false)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    onAtChange(fromPointer(e), true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = size
    const moves: Record<string, number | undefined> = {
      ArrowLeft: at - step,
      ArrowDown: at - step,
      ArrowRight: at + step,
      ArrowUp: at + step,
      PageDown: at - 6 * step,
      PageUp: at + 6 * step,
      Home: from,
      End: to,
    }
    const next = moves[e.key]
    if (next === undefined) return
    e.preventDefault()
    setPlaying(false)
    onAtChange(Math.min(to, Math.max(from, next)), true)
  }

  const atEnd = at >= to - 60_000
  const nextSpeed = () =>
    setSpeed(
      (s) =>
        PLAY_SPEEDS[
          (PLAY_SPEEDS.indexOf(s as (typeof PLAY_SPEEDS)[number]) + 1) % PLAY_SPEEDS.length
        ] ?? 1,
    )

  return (
    <section
      aria-label="Historique : remonter le temps sur la carte"
      className="glass rounded-2xl border border-border p-3 shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? pause() : setPlaying(true))}
          aria-label={playing ? 'Pause' : 'Lecture'}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-fg text-bg"
        >
          {playing ? (
            <Pause size={18} aria-hidden="true" fill="currentColor" />
          ) : (
            <Play size={18} aria-hidden="true" fill="currentColor" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tabular-nums">{fmtMoment(at)}</p>
          <p className="truncate text-xs text-muted">
            {atEnd ? 'maintenant' : fmtAgo(at, to)} · {hours} h de signaux
          </p>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="min-h-9 shrink-0 rounded-full border border-border px-3 text-xs font-semibold text-muted hover:text-fg"
        >
          Revenir au direct
        </button>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Instant affiché sur la carte"
        aria-valuemin={Math.round(from)}
        aria-valuemax={Math.round(to)}
        aria-valuenow={Math.round(at)}
        aria-valuetext={fmtMoment(at)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative mt-3 h-12 cursor-ew-resize touch-none overflow-hidden rounded-lg border border-border bg-bg/60 outline-offset-2 md:h-16"
      >
        {/* Fenêtre des signalements pris en compte à l'instant affiché. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 bg-accent/15"
          style={{ left: `${windowStart}%`, width: `${Math.max(0, atPct - windowStart)}%` }}
        />
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${buckets.length || 1} 100`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {buckets.map((b, i) => {
            if (b.total === 0) return null
            const scale = Math.max(100 / max, 5 / b.total)
            const hBloque = b.bloque * scale
            const hFiltrant = b.filtrant * scale
            const hLeve = b.leve * scale
            return (
              <g key={b.start}>
                <rect
                  x={i + 0.08}
                  y={100 - hBloque}
                  width={0.84}
                  height={hBloque}
                  className="fill-bloque"
                />
                <rect
                  x={i + 0.08}
                  y={100 - hBloque - hFiltrant}
                  width={0.84}
                  height={hFiltrant}
                  className="fill-filtrant"
                />
                <rect
                  x={i + 0.08}
                  y={100 - hBloque - hFiltrant - hLeve}
                  width={0.84}
                  height={hLeve}
                  className="fill-leve opacity-60"
                />
              </g>
            )
          })}
        </svg>
        {/* Le futur par rapport à l'instant affiché est estompé. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 bg-bg/55"
          style={{ left: `${atPct}%` }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-fg"
          style={{ left: `${atPct}%` }}
        >
          <span className="absolute -top-0 left-1/2 size-3 -translate-x-1/2 rounded-full bg-fg" />
        </div>
        {(isPending || isError) && (
          <p className="absolute inset-0 grid place-items-center bg-bg/70 text-xs font-semibold text-muted">
            {isError ? 'Historique indisponible pour le moment.' : "Chargement de l'historique…"}
          </p>
        )}
      </div>

      <div
        aria-hidden="true"
        className="mt-1 flex justify-between text-[11px] text-muted tabular-nums"
      >
        {Array.from({ length: TICKS }, (_, i) => (
          <span key={i}>{fmtTick(from + (span * i) / (TICKS - 1), span)}</span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div
          role="group"
          aria-label="Période de la frise"
          className="inline-flex rounded-full border border-border p-0.5 text-xs font-semibold"
        >
          {TIMELINE_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => onRangeChange(r)}
              className={`min-h-8 rounded-full px-2.5 whitespace-nowrap ${r === range ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}
            >
              {TIMELINE_RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <label className="flex items-center gap-1.5">
            Signal affiché
            <select
              value={hours}
              onChange={(e) => onHoursChange(Number(e.target.value))}
              className="min-h-8 rounded-md border border-border bg-surface px-1.5 text-xs font-semibold text-fg"
            >
              {hourOptions.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={nextSpeed}
            aria-label={`Vitesse de lecture ×${speed}, changer`}
            className="min-h-8 rounded-md border border-border px-2 font-semibold tabular-nums text-fg"
          >
            ×{speed}
          </button>
        </div>
      </div>
    </section>
  )
}
