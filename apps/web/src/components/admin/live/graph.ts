// Geometry of the live collection diagram and aggregation of trace events.
import type { TraceNode } from '@shared/trace.ts'

export interface TraceRow {
  id: number
  run_id: string
  t: string
  actor: 'collecteur' | 'lecteurs'
  target: string
  phase: 'start' | 'req' | 'res' | 'err' | 'end'
  label: string
  detail: string | null
  ms: number | null
  n: number | null
  status: number | null
}

export interface NodeDef {
  id: TraceNode
  title: string
  subtitle: string
  x: number
  y: number
  color: string
}

/** viewBox 1000 x 600: services on the left, readers and collector in the centre, AI and database on the right. */
export const VIEW = { w: 1000, h: 600 }
const LEFT_X = 118
const leftY = (i: number) => 66 + i * 78

export const NODES: NodeDef[] = [
  {
    id: 'google-news',
    title: 'Google Actualités',
    subtitle: 'recherches RSS',
    x: LEFT_X,
    y: leftY(0),
    color: '#4f8cff',
  },
  {
    id: 'google-decode',
    title: 'Google (liens)',
    subtitle: 'décodage',
    x: LEFT_X,
    y: leftY(1),
    color: '#7aa7ff',
  },
  {
    id: 'rss',
    title: 'Flux de presse',
    subtitle: 'RSS / Atom',
    x: LEFT_X,
    y: leftY(2),
    color: '#ff9f0a',
  },
  {
    id: 'pages',
    title: 'Articles',
    subtitle: 'sites de presse',
    x: LEFT_X,
    y: leftY(3),
    color: '#ffd60a',
  },
  {
    id: 'telegram',
    title: 'Telegram',
    subtitle: 't.me/s',
    x: LEFT_X,
    y: leftY(4),
    color: '#2aabee',
  },
  {
    id: 'bluesky',
    title: 'Bluesky',
    subtitle: 'AT Protocol',
    x: LEFT_X,
    y: leftY(5),
    color: '#3d8bfd',
  },
  {
    id: 'mymaps',
    title: 'My Maps',
    subtitle: 'export KML',
    x: LEFT_X,
    y: leftY(6),
    color: '#34c759',
  },
  { id: 'lecteurs', title: 'Lecteurs', subtitle: 'sous-appels', x: 430, y: 300, color: '#bf5af2' },
  {
    id: 'collecteur',
    title: 'Collecteur',
    subtitle: 'répartiteur',
    x: 668,
    y: 300,
    color: '#ff453a',
  },
  { id: 'gemini', title: 'Gemini', subtitle: 'extraction IA', x: 892, y: 110, color: '#64d2ff' },
  {
    id: 'jev',
    title: 'Jev (TypeSafe)',
    subtitle: 'juge : probabilité',
    x: 892,
    y: 270,
    color: '#e6b93a',
  },
  {
    id: 'reader',
    title: 'Passerelle de lecture',
    subtitle: 'pages fermées aux robots',
    x: 430,
    y: 500,
    color: '#2dd4bf',
  },
  {
    id: 'base',
    title: 'Base Manifeste',
    subtitle: 'rattachement',
    x: 892,
    y: 490,
    color: '#30d158',
  },
]

export const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]))
export const NODE_W = 196
export const NODE_H = 52

export interface EdgeDef {
  key: string
  from: TraceNode
  to: TraceNode
  path: string
  /** Anchor point of the label. */
  lx: number
  ly: number
  anchor: 'start' | 'middle' | 'end'
}

const SERVICES: TraceNode[] = [
  'google-news',
  'google-decode',
  'rss',
  'pages',
  'telegram',
  'bluesky',
  'mymaps',
]

function curve(from: NodeDef, to: NodeDef): { path: string; lx: number; ly: number } {
  // Exit through the nearest edge, horizontal Bézier curve.
  const dir = to.x >= from.x ? 1 : -1
  const x1 = from.x + (dir * NODE_W) / 2
  const x2 = to.x - (dir * NODE_W) / 2
  const mx = (x1 + x2) / 2
  return {
    path: `M ${x1} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${x2} ${to.y}`,
    lx: mx,
    ly: (from.y + to.y) / 2,
  }
}

function edge(from: TraceNode, to: TraceNode): EdgeDef {
  const a = NODE_BY_ID.get(from) as NodeDef
  const b = NODE_BY_ID.get(to) as NodeDef
  const { path, lx, ly } = curve(a, b)
  // Counter near the service (the edges converge towards the readers: in the middle, they would
  // overlap); above for the short collector → readers edge.
  const dir = b.x >= a.x ? 1 : -1
  const nearTarget = {
    lx: b.x - (dir * NODE_W) / 2 - dir * 10,
    ly: b.y - 10,
    anchor: dir > 0 ? ('end' as const) : ('start' as const),
  }
  const label =
    from === 'collecteur' && to === 'lecteurs'
      ? { lx, ly: ly - 34, anchor: 'middle' as const }
      : nearTarget
  return { key: `${from}>${to}`, from, to, path, ...label }
}

export const EDGES: EdgeDef[] = [
  ...SERVICES.map((s) => edge('lecteurs', s)),
  edge('collecteur', 'lecteurs'),
  edge('collecteur', 'gemini'),
  edge('collecteur', 'jev'),
  edge('collecteur', 'reader'),
  edge('collecteur', 'base'),
]
export const EDGE_BY_KEY = new Map(EDGES.map((e) => [e.key, e]))

/**
 * Edge of an event. A single-source collection reads its services itself
 * (actor "collecteur"): it is drawn on the readers' edge.
 */
export function edgeFor(actor: string, target: string): EdgeDef | null {
  return EDGE_BY_KEY.get(`${actor}>${target}`) ?? EDGE_BY_KEY.get(`lecteurs>${target}`) ?? null
}

export interface EdgeStats {
  req: number
  done: number
  err: number
  totalMs: number
  last: string
}

export interface RunStats {
  startedAt: number | null
  endedAt: number | null
  sources: number
  requests: number
  errors: number
  geminiCalls: number
  jevCalls: number
  readerCalls: number
  linked: number
  unmatched: number
  duplicates: number
  summary: string | null
  edges: Map<string, EdgeStats>
  nodes: Map<string, { hits: number; lastAt: number }>
}

export function emptyStats(): RunStats {
  return {
    startedAt: null,
    endedAt: null,
    sources: 0,
    requests: 0,
    errors: 0,
    geminiCalls: 0,
    jevCalls: 0,
    readerCalls: 0,
    linked: 0,
    unmatched: 0,
    duplicates: 0,
    summary: null,
    edges: new Map(),
    nodes: new Map(),
  }
}

/** Folds an event into the statistics (mutates in place: called on every frame). */
export function applyEvent(stats: RunStats, e: TraceRow, at: number): void {
  const t = Date.parse(e.t)
  if (e.phase === 'start') {
    stats.startedAt ??= t
    stats.sources += e.n ?? 0
    return
  }
  if (e.phase === 'end') {
    stats.endedAt = t
    stats.summary = [e.label, e.detail].filter(Boolean).join(' · ')
    return
  }
  stats.startedAt ??= t
  const ed = edgeFor(e.actor, e.target)
  if (ed) {
    const s = stats.edges.get(ed.key) ?? { req: 0, done: 0, err: 0, totalMs: 0, last: '' }
    if (e.phase === 'req') {
      s.req++
      s.last = e.label
    } else {
      s.done++
      if (e.phase === 'err') s.err++
      s.totalMs += e.ms ?? 0
    }
    stats.edges.set(ed.key, s)
  }
  const node = stats.nodes.get(e.target) ?? { hits: 0, lastAt: 0 }
  node.hits++
  node.lastAt = at
  stats.nodes.set(e.target, node)
  if (e.phase === 'req') {
    stats.requests++
    if (e.target === 'gemini') stats.geminiCalls++
    if (e.target === 'jev') stats.jevCalls++
    if (e.target === 'reader') stats.readerCalls++
  }
  if (e.phase === 'err') stats.errors++
  if (e.target === 'base' && e.phase !== 'req') {
    if (e.detail === 'rattache') stats.linked++
    else if (e.detail === 'non_rattache') stats.unmatched++
    else if (e.detail === 'doublon') stats.duplicates++
  }
}
