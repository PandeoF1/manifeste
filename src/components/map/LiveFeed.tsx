import { formatRelative, STATUS_LABELS } from '@shared/status.ts'
import { SourceConfidenceInline } from '@/components/status/SourceConfidence'
import { MobilisationIcon, StatusIcon } from '@/components/status/StatusIcon'
import type { SchoolStatus } from '@/queries/statuses'
import { useNow } from '@/lib/useNow'

const TEXT: Record<SchoolStatus['status'], string> = {
  bloque: 'text-bloque',
  filtrant: 'text-filtrant',
  leve: 'text-leve',
}

/** Fil des derniers signaux. Sert aussi d'alternative textuelle complète à la carte. */
export function LiveFeed({
  statuses,
  mobilisation = [],
  selectedUai,
  onSelect,
}: {
  statuses: ReadonlyArray<SchoolStatus>
  mobilisation?: ReadonlyArray<SchoolStatus>
  selectedUai: string | undefined
  onSelect: (uai: string) => void
}) {
  const now = useNow()
  const all = mobilisation.length
    ? [...statuses, ...mobilisation].sort((a, b) =>
        b.last_signal_at.localeCompare(a.last_signal_at),
      )
    : statuses
  if (all.length === 0) {
    return <p className="p-4 text-sm text-muted">Aucun blocus signalé pour le moment.</p>
  }
  return (
    <ol aria-label="Derniers signaux" className="divide-y divide-border">
      {all.map((s) => (
        <li key={s.uai}>
          <button
            type="button"
            onClick={() => onSelect(s.uai)}
            aria-current={s.uai === selectedUai ? 'true' : undefined}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface aria-[current=true]:bg-surface"
          >
            {s.mobilisation ? (
              <MobilisationIcon size={20} />
            ) : (
              <StatusIcon status={s.status} size={20} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-sm text-muted">
                {s.city}
                {s.department ? ` (${s.department})` : ''}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs">
              <span
                className={`block font-semibold ${s.mobilisation ? 'text-muted' : TEXT[s.status]}`}
              >
                {s.mobilisation ? 'Mobilisation signalée' : STATUS_LABELS[s.status]}
              </span>
              <time dateTime={s.last_signal_at} className="text-muted">
                {formatRelative(new Date(s.last_signal_at), now)}
              </time>
              <SourceConfidenceInline count={s.source_count} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}
