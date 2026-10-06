import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TraceRow } from './graph'

/** Décalage de lecture : les traces arrivent par paquets, on les rejoue avec leur vrai rythme. */
const LAG_MS = 900
/** Après la réponse de la collecte, silence au-delà duquel le passage est tenu pour fini. */
const SETTLE_MS = 4_000

/** Événement de fin du passage (les lecteurs n'en émettent pas). */
const isRunEnd = (e: TraceRow) => e.phase === 'end' && e.target === 'collecteur'

export type StreamState =
  | { kind: 'idle' }
  | { kind: 'connecting'; runId: string }
  | { kind: 'live'; runId: string }
  | { kind: 'replay'; runId: string; speed: number }
  | { kind: 'done'; runId: string }
  | { kind: 'error'; message: string }

/**
 * File d'événements d'une collecte : en direct (Realtime sur collector_trace, filtré par run)
 * ou rejouée depuis la base. `onEvent` reçoit chaque événement à son moment (horloge de lecture).
 * L'état passe à `done` quand l'événement de fin est joué (ou, à défaut, quelques secondes
 * après la réponse de la collecte).
 */
export function useTraceStream(onEvent: (e: TraceRow) => void) {
  const [state, setState] = useState<StreamState>({ kind: 'idle' })
  const queue = useRef<TraceRow[]>([])
  const clock = useRef<{ wall: number; first: number; speed: number } | null>(null)
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  })
  /** Moment où la collecte a répondu (filet si l'événement de fin n'arrive jamais). */
  const answeredAt = useRef<number | null>(null)
  const lastEventAt = useRef(0)

  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const closeChannel = useCallback(() => {
    if (channel.current) void supabase.removeChannel(channel.current)
    channel.current = null
  }, [])

  /** Passage terminé : on arrête d'écouter (les événements reçus ont tous été joués). */
  const finish = useCallback(() => {
    answeredAt.current = null
    closeChannel()
    setState((s) =>
      s.kind === 'live' || s.kind === 'replay' ? { kind: 'done', runId: s.runId } : s,
    )
  }, [closeChannel])

  // Horloge de lecture : libère les événements dont le moment est passé.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      const c = clock.current
      if (c && queue.current.length) {
        const playhead = c.first + (now - c.wall) * c.speed - LAG_MS
        while (queue.current.length && Date.parse((queue.current[0] as TraceRow).t) <= playhead) {
          const e = queue.current.shift() as TraceRow
          handler.current(e)
          if (isRunEnd(e)) finish()
        }
      } else if (
        answeredAt.current != null &&
        now - Math.max(answeredAt.current, lastEventAt.current) > SETTLE_MS
      ) {
        finish()
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [finish])

  const push = useCallback((rows: TraceRow[], speed = 1) => {
    if (rows.length === 0) return
    if (!clock.current) {
      clock.current = { wall: performance.now(), first: Date.parse((rows[0] as TraceRow).t), speed }
    }
    lastEventAt.current = performance.now()
    queue.current.push(...rows)
    queue.current.sort((a, b) => a.id - b.id)
  }, [])

  const reset = useCallback(() => {
    closeChannel()
    queue.current = []
    clock.current = null
    answeredAt.current = null
  }, [closeChannel])
  useEffect(() => reset, [reset])

  /** Écoute un passage puis appelle `start` une fois l'abonnement actif (rien n'est manqué). */
  const listen = useCallback(
    (runId: string, start: () => Promise<unknown>) => {
      reset()
      setState({ kind: 'connecting', runId })
      const ch = supabase
        .channel(`trace-${runId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'collector_trace',
            filter: `run_id=eq.${runId}`,
          },
          (payload) => push([payload.new as TraceRow]),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setState({ kind: 'live', runId })
            start()
              .catch((e: unknown) =>
                setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
              )
              .finally(() => {
                // La collecte a répondu : ses traces sont en base, il ne reste qu'à les jouer.
                answeredAt.current = performance.now()
              })
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setState({ kind: 'error', message: `Temps réel indisponible (${status})` })
          }
        })
      channel.current = ch
    },
    [push, reset],
  )

  /** Rejoue un passage enregistré (accéléré). */
  const replay = useCallback(
    async (speed: number) => {
      reset()
      const { data: last, error } = await supabase
        .from('collector_trace')
        .select('run_id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return setState({ kind: 'error', message: error.message })
      if (!last)
        return setState({ kind: 'error', message: 'Aucune collecte en direct enregistrée.' })
      const { data, error: e2 } = await supabase
        .from('collector_trace')
        .select('*')
        .eq('run_id', last.run_id)
        .order('id', { ascending: true })
        .limit(10_000)
      if (e2) return setState({ kind: 'error', message: e2.message })
      setState({ kind: 'replay', runId: last.run_id, speed })
      push(data as TraceRow[], speed)
      // Relecture d'un passage coupé (sans événement de fin) : fini une fois la file vidée.
      answeredAt.current = performance.now()
    },
    [push, reset],
  )

  return { state, listen, replay, reset }
}
