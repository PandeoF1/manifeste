import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TraceRow } from './graph'

/** Playback lag: traces arrive in batches, they are replayed at their real pace. */
const LAG_MS = 900
/** After the collection responds, silence beyond which the run is considered finished. */
const SETTLE_MS = 4_000

/** End-of-run event (readers do not emit one). */
const isRunEnd = (e: TraceRow) => e.phase === 'end' && e.target === 'collecteur'

export type StreamState =
  | { kind: 'idle' }
  | { kind: 'connecting'; runId: string }
  | { kind: 'live'; runId: string }
  | { kind: 'replay'; runId: string; speed: number }
  | { kind: 'done'; runId: string }
  | { kind: 'error'; message: string }

/**
 * Event queue of a collection: live (Realtime on collector_trace, filtered by run)
 * or replayed from the database. `onEvent` receives each event at its moment (playback clock).
 * The state goes to `done` when the end event is played (or, failing that, a few seconds
 * after the collection responds).
 */
export function useTraceStream(onEvent: (e: TraceRow) => void) {
  const [state, setState] = useState<StreamState>({ kind: 'idle' })
  const queue = useRef<TraceRow[]>([])
  const clock = useRef<{ wall: number; first: number; speed: number } | null>(null)
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  })
  /** Moment the collection responded (safety net if the end event never arrives). */
  const answeredAt = useRef<number | null>(null)
  const lastEventAt = useRef(0)

  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const closeChannel = useCallback(() => {
    if (channel.current) void supabase.removeChannel(channel.current)
    channel.current = null
  }, [])

  /** Run finished: stop listening (the events received have all been played). */
  const finish = useCallback(() => {
    answeredAt.current = null
    closeChannel()
    setState((s) =>
      s.kind === 'live' || s.kind === 'replay' ? { kind: 'done', runId: s.runId } : s,
    )
  }, [closeChannel])

  // Playback clock: releases the events whose moment has passed.
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

  /** Listens to a run then calls `start` once the subscription is active (nothing is missed). */
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
                // The collection responded: its traces are in the database, they only need to be played.
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

  /** Replays a recorded run (sped up). */
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
      // Replay of an interrupted run (no end event): finished once the queue is empty.
      answeredAt.current = performance.now()
    },
    [push, reset],
  )

  return { state, listen, replay, reset }
}
