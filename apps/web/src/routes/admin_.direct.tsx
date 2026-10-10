import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, History, Radio } from 'lucide-react'
import { LoginForm } from '@/components/admin/LoginForm'
import { LiveDiagram, type DiagramHandle } from '@/components/admin/live/LiveDiagram'
import {
  NODE_BY_ID,
  applyEvent,
  edgeFor,
  emptyStats,
  type RunStats,
  type TraceRow,
} from '@/components/admin/live/graph'
import { useTraceStream } from '@/components/admin/live/useTraceStream'
import { supabase } from '@/lib/supabase'
import { isAdminSession, sourcesQuery, useSession } from '@/queries/admin'

export const Route = createFileRoute('/admin_/direct')({
  component: LivePage,
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
})

interface LogLine {
  id: number
  time: string
  text: string
  tone: 'req' | 'ok' | 'err' | 'sys' | 'base'
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
} as Intl.DateTimeFormatOptions)

const OUTCOME_LABEL: Record<string, string> = {
  rattache: 'rattaché',
  non_rattache: 'non rattaché',
  doublon: 'doublon',
  certitude_faible: 'certitude faible',
  erreur: 'erreur',
}

function toLine(e: TraceRow): LogLine {
  const time = timeFmt.format(new Date(e.t))
  const target = NODE_BY_ID.get(e.target as never)?.title ?? e.target
  const base = { id: e.id, time }
  switch (e.phase) {
    case 'start':
      return {
        ...base,
        tone: 'sys',
        text: `▶ départ · ${e.label}${e.detail ? ` · ${e.detail}` : ''}`,
      }
    case 'end':
      return {
        ...base,
        tone: 'sys',
        text: `■ fin · ${e.label}${e.detail ? ` · ${e.detail}` : ''}${e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''}`,
      }
    case 'req':
      return {
        ...base,
        tone: e.target === 'base' ? 'base' : 'req',
        text: `→ ${target.padEnd(17)} ${e.detail ?? ''} ${e.label}`,
      }
    default:
      return {
        ...base,
        tone: e.phase === 'err' ? 'err' : e.target === 'base' ? 'base' : 'ok',
        text:
          e.target === 'base'
            ? `← ${target.padEnd(17)} ${OUTCOME_LABEL[e.detail ?? ''] ?? e.detail ?? ''} · ${e.label}`
            : `← ${target.padEnd(17)} ${e.status ?? e.detail ?? 'erreur'}${e.ms != null ? ` ${e.ms} ms` : ''} ${e.label}`,
      }
  }
}

const TONE: Record<LogLine['tone'], string> = {
  req: 'text-sky-300',
  ok: 'text-emerald-300',
  err: 'text-red-400',
  sys: 'text-amber-300 font-semibold',
  base: 'text-fuchsia-300',
}

interface View {
  stats: RunStats
  lines: LogLine[]
  lastT: number | null
  now: number
}

/** Copie des statistiques pour le rendu (les refs, elles, sont mises à jour à chaque événement). */
function snapshot(st: RunStats): RunStats {
  return {
    ...st,
    edges: new Map([...st.edges].map(([k, v]) => [k, { ...v }])),
    nodes: new Map([...st.nodes].map(([k, v]) => [k, { ...v }])),
  }
}

function LivePage() {
  const session = useSession()
  if (session.isPending) return <div className="flex-1 animate-pulse bg-surface" />
  if (!session.data) return <LoginForm />
  if (!isAdminSession(session.data)) return <main className="p-6">Réservé à l'équipe.</main>
  return <LiveCollect />
}

function LiveCollect() {
  const sources = useQuery(sourcesQuery)
  const [sourceId, setSourceId] = useState('')
  const [speed, setSpeed] = useState(4)
  const stats = useRef<RunStats>(emptyStats())
  const lines = useRef<LogLine[]>([])
  const lastT = useRef<number | null>(null)
  const diagram = useRef<DiagramHandle>(null)
  const [view, setView] = useState<View>(() => ({
    stats: emptyStats(),
    lines: [],
    lastT: null,
    now: performance.now(),
  }))
  const [invokeError, setInvokeError] = useState<string | null>(null)

  const onEvent = useCallback((e: TraceRow) => {
    const at = performance.now()
    applyEvent(stats.current, e, at)
    lastT.current = Date.parse(e.t)
    lines.current.push(toLine(e))
    if (lines.current.length > 400) lines.current.splice(0, lines.current.length - 400)
    const ed = edgeFor(e.actor, e.target)
    if (ed && e.phase !== 'start' && e.phase !== 'end') {
      const node = NODE_BY_ID.get(e.target as never)
      const color =
        e.phase === 'req'
          ? (node?.color ?? '#94a3b8')
          : e.phase === 'err'
            ? '#ff453a'
            : e.target === 'base' && e.detail !== 'rattache'
              ? '#ff9f0a'
              : '#30d158'
      diagram.current?.spawn(
        ed.key,
        e.phase !== 'req',
        color,
        e.target === 'base' || e.target === 'gemini' || e.target === 'jev',
      )
    }
  }, [])
  const stream = useTraceStream(onEvent)

  // Rafraîchit compteurs et terminal ~7 fois par seconde (les particules, elles, vont à 60 i/s).
  useEffect(() => {
    const id = window.setInterval(() => {
      setView({
        stats: snapshot(stats.current),
        lines: lines.current.slice(),
        lastT: lastT.current,
        now: performance.now(),
      })
    }, 140)
    return () => window.clearInterval(id)
  }, [])

  const resetView = () => {
    stats.current = emptyStats()
    lines.current = []
    lastT.current = null
    setInvokeError(null)
  }

  const launch = () => {
    resetView()
    const runId = crypto.randomUUID()
    stream.listen(runId, async () => {
      const { error } = await supabase.functions.invoke('collect', {
        body: sourceId ? { source_id: sourceId, run_id: runId } : { run_id: runId },
      })
      // La collecte peut dépasser le délai de réponse : les traces, elles, continuent d'arriver.
      if (error) setInvokeError(error.message)
    })
  }

  const replay = () => {
    resetView()
    void stream.replay(speed)
  }

  const s = view.stats
  const elapsed =
    s.startedAt != null && view.lastT != null ? ((s.endedAt ?? view.lastT) - s.startedAt) / 1000 : 0
  const running = stream.state.kind === 'live' || stream.state.kind === 'connecting'

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#05070b] text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-3">
        <Link
          to="/admin"
          search={{ tab: 'sources' }}
          className="icon-btn text-slate-300"
          aria-label="Retour à l'admin"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="flex items-center gap-2 font-mono text-lg font-bold tracking-tight">
          <span
            className={`size-2.5 rounded-full ${running ? 'live-dot bg-red-500' : 'bg-slate-600'}`}
            aria-hidden="true"
          />
          collecte://direct
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            className="h-10 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            aria-label="Sources à collecter"
            disabled={running}
          >
            <option value="">Toutes les sources</option>
            {sources.data?.map((src) => (
              <option key={src.id} value={src.id}>
                {src.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={launch}
            disabled={running}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Radio size={16} aria-hidden="true" /> {running ? 'En cours…' : 'Lancer en direct'}
          </button>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={replay}
              disabled={running}
              className="inline-flex h-10 items-center gap-2 rounded-l-md border border-slate-700 px-3 text-sm hover:bg-slate-900 disabled:opacity-50"
            >
              <History size={16} aria-hidden="true" /> Revoir le dernier
            </button>
            <select
              className="h-10 rounded-r-md border border-l-0 border-slate-700 bg-slate-900 px-2 text-sm"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              aria-label="Vitesse de relecture"
            >
              {[1, 2, 4, 10].map((v) => (
                <option key={v} value={v}>
                  ×{v}
                </option>
              ))}
            </select>
          </span>
        </div>
      </header>

      <dl className="grid grid-cols-4 gap-px border-b border-slate-800 bg-slate-800 font-mono text-xs sm:grid-cols-10">
        {[
          ['durée', `${elapsed.toFixed(1)} s`],
          ['sources', s.sources],
          ['requêtes', s.requests],
          ['erreurs', s.errors],
          ['gemini', s.geminiCalls],
          ['jev', s.jevCalls],
          ['lectures', s.readerCalls],
          ['rattachés', s.linked],
          ['non rattachés', s.unmatched],
          ['doublons', s.duplicates],
        ].map(([k, v]) => (
          <div key={k} className="bg-[#05070b] px-3 py-2">
            <dt className="text-slate-500 uppercase">{k}</dt>
            <dd
              className={`text-lg font-bold ${k === 'erreurs' && Number(v) > 0 ? 'text-red-400' : ''}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>

      {(stream.state.kind === 'error' || invokeError || s.summary) && (
        <p
          role="status"
          className={`border-b border-slate-800 px-4 py-2 font-mono text-sm ${
            stream.state.kind === 'error' || invokeError ? 'text-red-400' : 'text-amber-300'
          }`}
        >
          {stream.state.kind === 'error'
            ? stream.state.message
            : invokeError
              ? `Réponse de la collecte : ${invokeError} (les traces continuent si elle tourne encore)`
              : `■ ${s.summary}`}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_420px]">
        <section className="relative border-slate-800 p-2 lg:border-r" aria-label="Diagramme">
          <LiveDiagram ref={diagram} stats={s} now={view.now} />
          {stream.state.kind === 'idle' && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center font-mono text-sm text-slate-500">
              Lance une collecte en direct, ou revois la dernière.
            </p>
          )}
        </section>
        <section aria-label="Journal des requêtes" className="flex min-h-[280px] flex-col">
          <h2 className="border-b border-slate-800 px-3 py-2 font-mono text-xs text-slate-500 uppercase">
            stdout · {view.lines.length} lignes
          </h2>
          <Terminal lines={view.lines} />
        </section>
      </div>
    </main>
  )
}

function Terminal({ lines }: { lines: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
      className="h-[360px] overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5 lg:h-[calc(100dvh-230px)]"
    >
      {lines.map((l) => (
        <div key={l.id} className={`truncate whitespace-pre ${TONE[l.tone]}`} title={l.text}>
          <span className="text-slate-600">{l.time} </span>
          {l.text}
        </div>
      ))}
    </div>
  )
}
