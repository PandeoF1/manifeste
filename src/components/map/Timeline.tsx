import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
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
  type Bucket,
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

/** Barres de l'histogramme : ne se redessinent que si les données changent (pas à chaque image de la lecture). */
const Bars = memo(function Bars({ buckets, max }: { buckets: Bucket[]; max: number }) {
  return (
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
  )
})

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
  // Pendant la lecture, la tête avance à chaque image (fluide) ; la carte, elle, n'est mise à jour
  // que ~10 fois par seconde.
  const [pos, setPos] = useState(at)
  const shownAt = playing ? pos : at
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const span = Math.max(1, to - from)
  const size = bucketSize(span)

  // Valeurs courantes pour la boucle de lecture (qui ne doit pas redémarrer à chaque image).
  const live = useRef({ at, pos, from, to, speed, onAtChange })
  useEffect(() => {
    live.current = { at, pos, from, to, speed, onAtChange }
  })

  useEffect(() => {
    if (!playing) return
    let current = live.current.pos
    let last = performance.now()
    let lastEmit = 0
    let raf = 0
    const tick = (now: number) => {
      const cur = live.current
      current = advance(current, now - last, cur.from, cur.to, cur.speed)
      last = now
      if (current >= cur.to) {
        setPos(cur.to)
        cur.onAtChange(cur.to, true)
        setPlaying(false)
        return
      }
      setPos(current)
      if (now - lastEmit >= 100) {
        lastEmit = now
        cur.onAtChange(current, false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Glisser le curseur : au plus un changement par image, même si la souris en envoie davantage.
  const queued = useRef<{ ms: number; raf: number }>({ ms: 0, raf: 0 })
  const queueAt = (ms: number) => {
    const q = queued.current
    q.ms = ms
    if (q.raf) return
    q.raf = requestAnimationFrame(() => {
      q.raf = 0
      live.current.onAtChange(q.ms, false)
    })
  }
  const cancelQueued = () => {
    cancelAnimationFrame(queued.current.raf)
    queued.current.raf = 0
  }
  // Pas de sélection de texte (ni d'image traînée) pendant le glissé, même hors de la frise.
  const lockSelection = (on: boolean) => document.body.classList.toggle('select-none', on)
  useEffect(
    () => () => {
      cancelAnimationFrame(queued.current.raf)
      document.body.classList.remove('select-none')
    },
    [],
  )

  const startPlay = () => {
    const begin = at >= to - 60_000 ? from : at
    setPos(begin)
    onAtChange(begin, false)
    setPlaying(true)
  }

  const buckets = useMemo(
    () => (data ? bucketize(data.events, from, to, size) : []),
    [data, from, to, size],
  )
  const max = useMemo(() => Math.max(1, ...buckets.map((b) => b.total)), [buckets])

  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - from) / span) * 100))
  const atPct = pct(shownAt)
  const windowStart = pct(shownAt - hours * HOUR)

  const pause = () => {
    setPlaying(false)
    onAtChange(pos, true)
  }

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return at
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    return from + f * span
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    lockSelection(true)
    setPlaying(false)
    queueAt(fromPointer(e))
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) queueAt(fromPointer(e))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    lockSelection(false)
    cancelQueued()
    onAtChange(fromPointer(e), true)
  }
  // Geste annulé par le navigateur (le téléphone reprend la main) : on garde la dernière position
  // valide au lieu de lire des coordonnées qui n'en sont pas.
  const onPointerCancel = () => {
    if (!dragging.current) return
    dragging.current = false
    lockSelection(false)
    cancelQueued()
    onAtChange(live.current.at, true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = size
    const at = shownAt
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

  const atEnd = shownAt >= to - 60_000
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
      onDragStart={(e) => e.preventDefault()}
      className="glass rounded-2xl border border-border p-3 shadow-2xl select-none"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (playing ? pause() : startPlay())}
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
          <p className="truncate text-sm font-bold tabular-nums">{fmtMoment(shownAt)}</p>
          <p className="truncate text-xs text-muted">
            {atEnd ? 'maintenant' : fmtAgo(shownAt, to)} · {hours} h de signaux
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
        aria-valuenow={Math.round(shownAt)}
        aria-valuetext={fmtMoment(shownAt)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        className="relative mt-3 h-12 cursor-ew-resize touch-none overflow-hidden rounded-lg border border-border bg-bg/60 outline-offset-2 md:h-16"
      >
        {/* Fenêtre des signalements pris en compte à l'instant affiché. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 bg-accent/15"
          style={{ left: `${windowStart}%`, width: `${Math.max(0, atPct - windowStart)}%` }}
        />
        <Bars buckets={buckets} max={max} />
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
