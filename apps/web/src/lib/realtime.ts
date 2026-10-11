import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { origin } from './api'
import { debounce } from './debounce'
import { queryKeys } from './queryKeys'

/** A burst of reports (collector) triggers a single refetch. */
const REFETCH_DELAY_MS = 3000
const RECONNECT_MIN_MS = 2_000
const RECONNECT_MAX_MS = 60_000

/**
 * Listens to the public WebSocket (/api/ws): the server only says "something changed" (with the
 * school's UAI when there is one), the app refetches through the normal queries. If the socket is
 * down the queries still poll, so the site never depends on it.
 */
export function useReportsRealtime() {
  const queryClient = useQueryClient()
  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let delay = RECONNECT_MIN_MS
    let closed = false
    const invalidateStatuses = debounce(
      () => void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all }),
      REFETCH_DELAY_MS,
    )

    const connect = () => {
      if (closed) return
      socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/api/ws`)
      socket.onopen = () => {
        delay = RECONNECT_MIN_MS
      }
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as {
            topic?: string
            data?: { uai?: string }
          }
          if (event.topic !== 'statuses') return
          invalidateStatuses()
          if (event.data?.uai)
            void queryClient.invalidateQueries({ queryKey: queryKeys.school(event.data.uai) })
        } catch {
          // not for us
        }
      }
      socket.onclose = () => {
        if (closed) return
        retry = setTimeout(connect, delay)
        delay = Math.min(delay * 2, RECONNECT_MAX_MS)
      }
    }
    connect()
    return () => {
      closed = true
      invalidateStatuses.cancel()
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [queryClient])
}
