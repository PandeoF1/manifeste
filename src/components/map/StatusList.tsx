import { formatRelative } from '@shared/status.ts'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { SchoolStatus } from '@/queries/statuses'

/** Alternative textuelle à la carte (accessibilité, lecteurs d'écran). */
export function StatusList({
  statuses,
  onSelect,
}: {
  statuses: ReadonlyArray<SchoolStatus>
  onSelect: (uai: string) => void
}) {
  if (statuses.length === 0) {
    return <p className="p-4 text-sm text-muted">Aucun blocus signalé pour le moment.</p>
  }
  return (
    <ul className="divide-y divide-border">
      {statuses.map((s) => (
        <li key={s.uai}>
          <button
            type="button"
            onClick={() => onSelect(s.uai)}
            className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-bg"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-sm text-muted">
                {s.city} · {formatRelative(new Date(s.last_signal_at))}
              </span>
            </span>
            <StatusBadge status={s.status} />
          </button>
        </li>
      ))}
    </ul>
  )
}
