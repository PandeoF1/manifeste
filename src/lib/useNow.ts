import { useEffect, useState } from 'react'

/** Horloge partagée par les libellés "il y a X min" (rafraîchie toutes les 30 s). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
