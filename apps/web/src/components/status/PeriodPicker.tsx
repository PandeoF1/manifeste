import { History } from 'lucide-react'
import { PERIODS, PERIOD_SHORT_LABELS, type Period } from '@/lib/periods'

/**
 * Period choice: segmented bar of toggle buttons. With `history`, a last button
 * "Historique" opens the timeline to replay the map; it then replaces the period choice.
 */
export function PeriodPicker({
  value,
  onChange,
  history,
  className = '',
}: {
  value: Period
  onChange: (period: Period) => void
  history?: { active: boolean; onSelect: () => void }
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label="Période affichée"
      className={`inline-flex rounded-full border border-border bg-bg/70 p-0.5 text-xs font-semibold ${className}`}
    >
      {PERIODS.map((p) => {
        const active = !history?.active && p === value
        return (
          <button
            key={p}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(p)}
            className={`min-h-8 rounded-full whitespace-nowrap transition-colors ${history ? 'px-2.5' : 'px-3'} ${
              active ? 'bg-fg text-bg' : 'text-muted hover:text-fg'
            }`}
          >
            {p === 'direct' && (
              <span
                aria-hidden="true"
                className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${active ? 'bg-bloque' : 'bg-muted'}`}
              />
            )}
            {PERIOD_SHORT_LABELS[p]}
          </button>
        )
      })}
      {history && (
        <button
          type="button"
          aria-pressed={history.active}
          onClick={history.onSelect}
          className={`inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 whitespace-nowrap transition-colors ${
            history.active ? 'bg-fg text-bg' : 'text-muted hover:text-fg'
          }`}
        >
          <History size={13} aria-hidden="true" />
          Historique
        </button>
      )}
    </div>
  )
}
