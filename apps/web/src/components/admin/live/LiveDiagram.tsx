import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EDGES, NODES, NODE_H, NODE_W, VIEW, type RunStats } from './graph'

export interface DiagramHandle {
  /** Lance une particule sur une arête : aller (req) ou retour (res / err). */
  spawn(edgeKey: string, back: boolean, color: string, big?: boolean): void
}

interface Particle {
  el: SVGCircleElement
  trail: SVGCircleElement
  path: SVGPathElement
  len: number
  start: number
  dur: number
  back: boolean
}

const MAX_PARTICLES = 500
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Diagramme animé : nœuds, arêtes, compteurs et particules (animées hors React, à 60 i/s). */
export const LiveDiagram = forwardRef<DiagramHandle, { stats: RunStats; now: number }>(
  function LiveDiagram({ stats, now }, ref) {
    const paths = useRef(new Map<string, SVGPathElement>())
    const layer = useRef<SVGGElement>(null)
    const particles = useRef<Particle[]>([])

    useImperativeHandle(ref, () => ({
      spawn(edgeKey, back, color, big = false) {
        const path = paths.current.get(edgeKey)
        const g = layer.current
        if (!path || !g) return
        if (particles.current.length >= MAX_PARTICLES) {
          const old = particles.current.shift()
          old?.el.remove()
          old?.trail.remove()
        }
        const trail = document.createElementNS(SVG_NS, 'circle')
        trail.setAttribute('r', big ? '9' : '6')
        trail.setAttribute('fill', color)
        trail.setAttribute('opacity', '0.25')
        trail.setAttribute('filter', 'url(#blur)')
        const el = document.createElementNS(SVG_NS, 'circle')
        el.setAttribute('r', big ? '4.5' : '3')
        el.setAttribute('fill', color)
        g.append(trail, el)
        particles.current.push({
          el,
          trail,
          path,
          len: path.getTotalLength(),
          start: performance.now(),
          dur: 650 + Math.random() * 350,
          back,
        })
      },
    }))

    useEffect(() => {
      let frame = 0
      const tick = (t: number) => {
        frame = requestAnimationFrame(tick)
        const alive: Particle[] = []
        for (const p of particles.current) {
          const k = (t - p.start) / p.dur
          if (k >= 1) {
            p.el.remove()
            p.trail.remove()
            continue
          }
          const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
          const at = p.len * (p.back ? 1 - eased : eased)
          const pt = p.path.getPointAtLength(at)
          p.el.setAttribute('cx', String(pt.x))
          p.el.setAttribute('cy', String(pt.y))
          const behind = p.path.getPointAtLength(
            Math.max(0, Math.min(p.len, at + (p.back ? 14 : -14))),
          )
          p.trail.setAttribute('cx', String(behind.x))
          p.trail.setAttribute('cy', String(behind.y))
          alive.push(p)
        }
        particles.current = alive
      }
      frame = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(frame)
    }, [])

    return (
      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label="Diagramme des requêtes de la collecte en cours"
      >
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#111827" strokeWidth="1" />
          </pattern>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="blur">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width={VIEW.w} height={VIEW.h} fill="url(#grid)" />

        {/* Arêtes */}
        {EDGES.map((e) => {
          const s = stats.edges.get(e.key)
          const inFlight = s ? s.req - s.done : 0
          const color = NODES.find((n) => n.id === e.to)?.color ?? '#94a3b8'
          const active = inFlight > 0
          return (
            <g key={e.key}>
              <path
                ref={(el) => {
                  if (el) paths.current.set(e.key, el)
                }}
                d={e.path}
                fill="none"
                stroke={s ? color : '#1f2937'}
                strokeOpacity={s ? 0.35 : 1}
                strokeWidth={active ? 2.5 : 1.5}
              />
              {active && (
                <path
                  d={e.path}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray="4 10"
                  className="live-dash"
                />
              )}
              {s && (
                <text
                  x={e.lx}
                  y={e.ly}
                  textAnchor={e.anchor}
                  className="font-mono"
                  fontSize="10.5"
                  fill="#cbd5e1"
                  paintOrder="stroke"
                  stroke="#05070b"
                  strokeWidth="4"
                >
                  {s.req} req{inFlight > 0 ? ` · ${inFlight} en vol` : ''}
                  {s.err > 0 ? ` · ${s.err} err` : ''}
                  {s.totalMs > 0 ? ` · ${Math.round(s.totalMs / s.done)} ms` : ''}
                </text>
              )}
            </g>
          )
        })}

        {/* Nœuds */}
        {NODES.map((n) => {
          const st = stats.nodes.get(n.id)
          const hot = st ? now - st.lastAt < 450 : false
          return (
            <g key={n.id} transform={`translate(${n.x - NODE_W / 2} ${n.y - NODE_H / 2})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx="12"
                fill="#0b0f17"
                stroke={n.color}
                strokeOpacity={st ? 0.95 : 0.35}
                strokeWidth={hot ? 2.5 : 1.25}
                filter={hot ? 'url(#glow)' : undefined}
              />
              <circle cx="16" cy={NODE_H / 2} r="5" fill={n.color} opacity={st ? 1 : 0.3}>
                {hot && (
                  <animate attributeName="r" values="5;8;5" dur="0.6s" repeatCount="indefinite" />
                )}
              </circle>
              <text x="30" y="22" fontSize="13" fontWeight="700" fill="#f1f5f9">
                {n.title}
              </text>
              <text x="30" y="39" fontSize="10.5" fill="#94a3b8" className="font-mono">
                {n.subtitle}
              </text>
              {st && (
                <text
                  x={NODE_W - 12}
                  y="22"
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="700"
                  fill={n.color}
                  className="font-mono"
                >
                  {st.hits}
                </text>
              )}
            </g>
          )
        })}

        <g ref={layer} />
      </svg>
    )
  },
)
