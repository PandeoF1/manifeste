/**
 * WebSocket endpoints fed by the event bus.
 *   /api/ws        public: "statuses changed" signals (the map and the list refetch)
 *   /api/ws/staff  signed-in staff: also moderation and pipeline signals, by role
 * Messages are small hints `{ topic, data? }`; clients refetch through the normal API, so a
 * missed message costs nothing (they also poll).
 */
import { Elysia, t } from 'elysia'
import type { Auth } from '../auth/auth.ts'
import { authPlugin } from '../auth/plugin.ts'
import { PUBLIC_TOPICS, TOPICS, type BusEvent, type EventBus, type Topic } from './bus.ts'

const message = t.Object({
  topic: t.UnionEnum([...TOPICS]),
  data: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number(), t.Boolean(), t.Null()]))),
})

/** Moderators follow the queue; admins also watch the pipeline. */
const STAFF_TOPICS: Record<string, readonly Topic[]> = {
  admin: TOPICS,
  moderator: ['statuses', 'moderation'],
}

export const realtimeModule = (bus: EventBus, auth: Auth) => {
  const unsubscribers = new Map<string, () => void>()
  const watch = (id: string, topics: readonly Topic[], send: (e: BusEvent) => void) => {
    unsubscribers.set(
      id,
      bus.subscribe((event) => {
        if (topics.includes(event.topic)) send(event)
      }),
    )
  }
  const unwatch = (id: string) => {
    unsubscribers.get(id)?.()
    unsubscribers.delete(id)
  }

  return new Elysia({ name: 'module.realtime', prefix: '/api/ws' })
    .use(authPlugin(auth))
    .ws('/', {
      response: message,
      open: (ws) => watch(ws.id, PUBLIC_TOPICS, (e) => ws.send(e)),
      close: (ws) => unwatch(ws.id),
    })
    .ws('/staff', {
      staff: true,
      response: message,
      open: (ws) => {
        const topics = STAFF_TOPICS[ws.data.staff.user.role ?? ''] ?? PUBLIC_TOPICS
        watch(ws.id, topics, (e) => ws.send(e))
      },
      close: (ws) => unwatch(ws.id),
    })
}
