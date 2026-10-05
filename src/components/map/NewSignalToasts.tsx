import { useEffect, useRef, useState } from 'react'
import { STATUS_LABELS } from '@shared/status.ts'
import { StatusIcon } from '@/components/status/StatusIcon'
import type { SchoolStatus } from '@/queries/statuses'

interface Toast {
  key: string
  school: SchoolStatus
}

const MAX = 3
const TTL_MS = 7000

/**
 * Affiche une alerte quand un lycée passe en bloqué / filtrant pendant qu'on regarde la carte.
 * Rien au premier chargement (sinon tout s'afficherait d'un coup).
 */
export function NewSignalToasts({
  statuses,
  onSelect,
}: {
  statuses: ReadonlyArray<SchoolStatus>
  onSelect: (uai: string) => void
}) {
  const known = useRef<Map<string, string> | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const previous = known.current
    known.current = new Map(statuses.map((s) => [s.uai, s.status]))
    if (!previous) return
    const fresh = statuses.filter((s) => s.status !== 'leve' && previous.get(s.uai) !== s.status)
    if (fresh.length === 0) return
    setToasts((t) =>
      [
        ...fresh.map((school) => ({ key: `${school.uai}:${school.last_signal_at}`, school })),
        ...t,
      ].slice(0, MAX),
    )
  }, [statuses])

  useEffect(() => {
    if (toasts.length === 0) return
    const id = window.setTimeout(() => setToasts((t) => t.slice(0, -1)), TTL_MS)
    return () => window.clearTimeout(id)
  }, [toasts])

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-3 bottom-4 z-20 flex flex-col items-center gap-2 md:inset-x-auto md:bottom-auto md:top-3 md:right-16 md:items-end"
    >
      {toasts.map(({ key, school }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(school.uai)}
          className="toast-in glass pointer-events-auto flex min-h-12 max-w-sm items-center gap-3 rounded-xl border border-border px-4 py-2 text-left shadow-2xl"
        >
          <StatusIcon status={school.status} size={20} />
          <span className="min-w-0 text-sm">
            <span className="block text-xs font-semibold tracking-wider text-muted uppercase">
              Nouveau signal
            </span>
            <span className="block truncate font-semibold">
              {school.name} · {school.city}
            </span>
            <span className="block">{STATUS_LABELS[school.status]}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
