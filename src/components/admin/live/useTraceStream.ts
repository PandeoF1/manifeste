import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TraceRow } from './graph'

/** Décalage de lecture : les traces arrivent par paquets, on les rejoue avec leur vrai rythme. */
const LAG_MS = 900

export type StreamState =
  | { kind: 'idle' }
  | { kind: 'connecting'; runId: string }
  | { kind: 'live'; runId: string }
  | { kind: 'replay'; runId: string; speed: number }
  | { kind: 'error'; message: string }

/**
 * File d'événements d'une collecte : en direct (Realtime sur collector_trace, filtré par run)
 * ou rejouée depuis la base. `onEvent` reçoit chaque événement à son moment (horloge de lecture).
 */
export function useTraceStream(onEvent: (e: TraceRow) => void) {
  const [state, setState] = useState<StreamState>({ kind: 'idle' })
  const queue = useRef<TraceRow[]>([])
  const clock = useRef<{ wall: number; first: number; speed: number } | null>(null)
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  })

  // Horloge de lecture : libère les événements dont le moment est passé.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const c = clock.current
      if (!c || queue.current.length === 0) return
      const playhead = c.first + (performance.now() - c.wall) * c.speed - LAG_MS
      while (queue.current.length && Date.parse((queue.current[0] as TraceRow).t) <= playhead) {
        handler.current(queue.current.shift() as TraceRow)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const push = useCallback((rows: TraceRow[], speed = 1) => {
    if (rows.length === 0) return
    if (!clock.current) {
      clock.current = { wall: performance.now(), first: Date.parse((rows[0] as TraceRow).t), speed }
    }
    queue.current.push(...rows)
    queue.current.sort((a, b) => a.id - b.id)
  }, [])

  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const reset = useCallback(() => {
    if (channel.current) void supabase.removeChannel(channel.current)
    channel.current = null
    queue.current = []
    clock.current = null
  }, [])
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
            start().catch((e: unknown) =>
              setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
            )
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
    },
    [push, reset],
  )

  return { state, listen, replay, reset }
}
