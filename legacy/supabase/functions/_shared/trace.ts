// Traçage d'une collecte « en direct » (page admin /admin/direct) : chaque requête sortante
// devient un événement aller (req) puis retour (res / err), rangé par service. Activé seulement
// quand un admin lance une collecte en mode direct : les passages planifiés ne tracent rien.
import type { FetchLike } from './fetchers/types.ts'

/** Les nœuds du diagramme. */
export const TRACE_NODES = [
  'collecteur',
  'lecteurs',
  'google-news',
  'google-decode',
  'rss',
  'pages',
  'telegram',
  'bluesky',
  'mymaps',
  'gemini',
  'jev',
  'reader',
  'base',
] as const
export type TraceNode = (typeof TRACE_NODES)[number]
export type TracePhase = 'start' | 'req' | 'res' | 'err' | 'end'

export interface TraceEvent {
  run_id: string
  /** Moment de l'événement (ms epoch), pour rejouer avec le bon rythme. */
  t: number
  actor: 'collecteur' | 'lecteurs'
  target: TraceNode
  phase: TracePhase
  /** Libellé court : hôte, source, lycée… */
  label: string
  detail?: string | null
  ms?: number | null
  n?: number | null
  status?: number | null
}

export type TraceInput = Omit<TraceEvent, 'run_id' | 't'>

/** Service visé par une URL (les flux de sources connus sont passés en `feeds`). */
export function classifyUrl(url: string, feeds: ReadonlySet<string> = new Set()): TraceNode {
  if (feeds.has(url)) {
    if (url.startsWith('https://news.google.com/rss/')) return 'google-news'
    return 'rss'
  }
  const parsed = URL.canParse(url) ? new URL(url) : null
  if (!parsed) return 'pages'
  const host = parsed.hostname
  const path = parsed.pathname
  if (host === 'generativelanguage.googleapis.com') return 'gemini'
  if (host === 'api.typesafe.ai') return 'jev'
  if (host === 'r.jina.ai') return 'reader'
  if (host === 'news.google.com')
    return path.startsWith('/rss/search') ? 'google-news' : 'google-decode'
  if (host === 't.me') return 'telegram'
  if (host.endsWith('bsky.app') || host.endsWith('bsky.social')) return 'bluesky'
  if ((host === 'www.google.com' || host === 'google.com') && path.startsWith('/maps/d'))
    return 'mymaps'
  if (host.endsWith('.supabase.co') && path.startsWith('/functions/')) return 'lecteurs'
  if (/\/(rss|feed|atom)\b|\.(rss|xml)$|[?&]page=backend/i.test(url)) return 'rss'
  return 'pages'
}

/** Libellé court d'une URL : hôte + début du chemin. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.length > 28 ? `${u.pathname.slice(0, 27)}…` : u.pathname
    return `${host}${path === '/' ? '' : path}`
  } catch {
    return url.slice(0, 40)
  }
}

export interface Tracer {
  emit(e: TraceInput): void
  flush(): Promise<void>
}

/** Ne fait rien : collecte planifiée. */
export const noTracer: Tracer = { emit: () => {}, flush: async () => {} }

/**
 * Tampon d'événements envoyés par paquets (une insertion toutes les ~300 ms) pour ne pas
 * ralentir la collecte. `flush()` doit être attendu avant la fin de l'appel.
 */
export function createTracer(
  runId: string,
  sink: (events: TraceEvent[]) => Promise<void>,
  opts: { intervalMs?: number; maxBatch?: number; now?: () => number } = {},
): Tracer {
  const now = opts.now ?? Date.now
  const maxBatch = opts.maxBatch ?? 200
  const buffer: TraceEvent[] = []
  let pending: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | null = null

  const drain = () => {
    timer = null
    if (buffer.length === 0) return pending
    const batch = buffer.splice(0, maxBatch)
    // Une trace perdue ne doit jamais faire échouer la collecte.
    pending = pending.then(() => sink(batch).catch(() => {}))
    if (buffer.length) return drain()
    return pending
  }

  return {
    emit(e) {
      buffer.push({ ...e, run_id: runId, t: now() })
      if (buffer.length >= maxBatch) void drain()
      else if (!timer) timer = setTimeout(() => void drain(), opts.intervalMs ?? 300)
    },
    async flush() {
      if (timer) clearTimeout(timer)
      await drain()
    },
  }
}

/** `fetch` qui trace chaque requête (aller, puis retour ou erreur) sans en changer le résultat. */
export function tracingFetch(
  fetchFn: FetchLike,
  tracer: Tracer,
  actor: TraceEvent['actor'],
  feeds: ReadonlySet<string> = new Set(),
): FetchLike {
  return async (input, init) => {
    const target = classifyUrl(input, feeds)
    const label =
      target === 'gemini'
        ? geminiModel(input)
        : target === 'jev'
          ? 'juge'
          : target === 'reader'
            ? shortUrl(input.replace(/^https:\/\/r\.jina\.ai\//, ''))
            : shortUrl(input)
    const started = Date.now()
    tracer.emit({ actor, target, phase: 'req', label, detail: init?.method ?? 'GET' })
    try {
      const res = await fetchFn(input, init)
      tracer.emit({
        actor,
        target,
        phase: res.ok ? 'res' : 'err',
        label,
        status: res.status,
        ms: Date.now() - started,
      })
      return res
    } catch (e) {
      tracer.emit({
        actor,
        target,
        phase: 'err',
        label,
        detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
        ms: Date.now() - started,
      })
      throw e
    }
  }
}

function geminiModel(url: string): string {
  return url.match(/models\/([^:/?]+)/)?.[1] ?? 'gemini'
}
