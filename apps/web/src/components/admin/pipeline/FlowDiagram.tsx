/**
 * The pipeline as a circuit board: sources feed discover, then read, extract and resolve, and
 * reports come out. Each stage shows what it did in the last 24 hours and what waits for it; the
 * links pulse when the stage just worked. It reads the same numbers as the admin overview.
 */
import type { Overview } from './types'

interface Node {
  id: 'sources' | 'discover' | 'read' | 'extract' | 'resolve' | 'reports'
  label: string
  x: number
  /** What to show under the label. */
  detail: (o: Overview) => string
  /** What waits in front of the stage. */
  waiting?: (o: Overview) => number
  tone: (o: Overview) => 'ok' | 'warn' | 'bad' | 'idle'
}

const total = (o: Overview, stage: string, ...outcomes: string[]) =>
  Object.entries(o.stages[stage] ?? {}).reduce(
    (n, [k, v]) => (outcomes.length === 0 || outcomes.includes(k) ? n + v : n),
    0,
  )

const NODES: Node[] = [
  {
    id: 'sources',
    label: 'Sources',
    x: 60,
    detail: (o) => {
      const s = o.sources
      const healthy = (s.closed ?? 0) + (s.half_open ?? 0)
      return `${healthy} saine${healthy > 1 ? 's' : ''} · ${s.open ?? 0} en pause`
    },
    tone: (o) => ((o.sources.open ?? 0) > 0 ? 'warn' : 'ok'),
  },
  {
    id: 'discover',
    label: 'Découverte',
    x: 210,
    detail: (o) => `${o.funnel.discovered} éléments · ${total(o, 'discover', 'failed')} échecs`,
    tone: (o) =>
      total(o, 'discover', 'failed') > 0 ? 'warn' : total(o, 'discover') > 0 ? 'ok' : 'idle',
  },
  {
    id: 'read',
    label: 'Lecture',
    x: 360,
    detail: (o) => `${o.funnel.read} lus · ${o.states.unreadable ?? 0} illisibles`,
    waiting: (o) => o.states.discovered ?? 0,
    tone: (o) => ((o.states.unreadable ?? 0) > 5 ? 'warn' : total(o, 'read') > 0 ? 'ok' : 'idle'),
  },
  {
    id: 'extract',
    label: 'Extraction IA',
    x: 510,
    detail: (o) => `${o.funnel.extracted} analysés · ${o.states.deferred ?? 0} en attente`,
    waiting: (o) => (o.states.read ?? 0) + (o.states.deferred ?? 0),
    tone: (o) =>
      (o.states.failed ?? 0) > 0
        ? 'bad'
        : (o.states.deferred ?? 0) > 0
          ? 'warn'
          : total(o, 'extract') > 0
            ? 'ok'
            : 'idle',
  },
  {
    id: 'resolve',
    label: 'Rattachement',
    x: 660,
    detail: (o) => `${o.funnel.facts} faits · ${o.funnel.unmatched} non rattachés`,
    waiting: (o) => o.states.extracted ?? 0,
    tone: (o) => (o.funnel.unmatched > 0 ? 'warn' : total(o, 'store') > 0 ? 'ok' : 'idle'),
  },
  {
    id: 'reports',
    label: 'Signalements',
    x: 810,
    detail: (o) => `${o.funnel.reported} publiés ou en modération`,
    tone: (o) => (o.funnel.reported > 0 ? 'ok' : 'idle'),
  },
]

const TONE: Record<ReturnType<Node['tone']>, string> = {
  ok: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--poor)',
  idle: 'var(--border)',
}

export function FlowDiagram({ overview }: { overview: Overview }) {
  const flow = [
    overview.funnel.discovered,
    overview.funnel.relevant,
    overview.funnel.read,
    overview.funnel.extracted,
    overview.funnel.facts,
  ]
  const max = Math.max(1, ...flow)
  return (
    <svg
      viewBox="0 0 900 150"
      role="img"
      aria-label="Circuit du pipeline : sources, découverte, lecture, extraction, rattachement, signalements"
      className="w-full"
    >
      <defs>
        <style>{`@keyframes flow { to { stroke-dashoffset: -24; } } .flow { animation: flow 1.2s linear infinite; }
          @media (prefers-reduced-motion: reduce) { .flow { animation: none; } }`}</style>
      </defs>
      {NODES.slice(0, -1).map((n, i) => {
        const next = NODES[i + 1] as Node
        const w = 1.5 + (4 * (flow[i] ?? 0)) / max
        const active = (flow[i] ?? 0) > 0
        return (
          <g key={n.id}>
            <line
              x1={n.x + 46}
              y1={60}
              x2={next.x - 46}
              y2={60}
              stroke="var(--border)"
              strokeWidth={w}
            />
            {active && (
              <line
                x1={n.x + 46}
                y1={60}
                x2={next.x - 46}
                y2={60}
                stroke="var(--accent)"
                strokeWidth={Math.max(1.5, w - 1)}
                strokeDasharray="6 18"
                className="flow"
                opacity={0.8}
              />
            )}
          </g>
        )
      })}
      {NODES.map((n) => {
        const tone = n.tone(overview)
        const waiting = n.waiting?.(overview) ?? 0
        return (
          <g key={n.id} transform={`translate(${n.x - 46}, 30)`}>
            <rect
              width="92"
              height="60"
              rx="10"
              fill="var(--surface)"
              stroke={TONE[tone]}
              strokeWidth="2"
            />
            <circle cx="12" cy="12" r="4" fill={TONE[tone]} />
            <text x="46" y="26" textAnchor="middle" className="fill-fg text-[11px] font-semibold">
              {n.label}
            </text>
            {waiting > 0 && (
              <text
                x="46"
                y="46"
                textAnchor="middle"
                className="fill-muted text-[10px] tabular-nums"
              >
                {waiting} en file
              </text>
            )}
            <text x="46" y="82" textAnchor="middle" className="fill-muted text-[9px]">
              {n.detail(overview)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
