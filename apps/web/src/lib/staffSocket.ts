import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { origin } from './api'
import { queryKeys } from './queryKeys'

const RECONNECT_MIN_MS = 2_000
const RECONNECT_MAX_MS = 60_000

/**
 * The staff WebSocket (/api/ws/staff, authenticated by the session cookie). The server sends small
 * "something happened" signals per topic; this refreshes the admin queries that depend on them.
 * The queries also poll, so the admin keeps working when the socket is down.
 */
export function useStaffSocket(
  onEvent?: (event: { topic: string; data?: Record<string, unknown> }) => void,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let delay = RECONNECT_MIN_MS
    let closed = false
    let pending: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      if (pending) return
      pending = setTimeout(() => {
        pending = null
        void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
      }, 800)
    }
    const connect = () => {
      if (closed) return
      socket = new WebSocket(`${origin.replace(/^http/, 'ws')}/api/ws/staff`)
      socket.onopen = () => (delay = RECONNECT_MIN_MS)
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as {
            topic: string
            data?: Record<string, unknown>
          }
          onEvent?.(event)
          refresh()
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
      if (retry) clearTimeout(retry)
      if (pending) clearTimeout(pending)
      socket?.close()
    }
  }, [queryClient, onEvent])
}
