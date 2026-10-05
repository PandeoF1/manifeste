import { PERIODS, PERIOD_SHORT_LABELS, type Period } from '@/lib/periods'

/** Choix de la période : barre segmentée de boutons bascule. */
export function PeriodPicker({
  value,
  onChange,
  className = '',
}: {
  value: Period
  onChange: (period: Period) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label="Période affichée"
      className={`inline-flex rounded-full border border-border bg-bg/70 p-0.5 text-xs font-semibold ${className}`}
    >
      {PERIODS.map((p) => {
        const active = p === value
        return (
          <button
            key={p}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(p)}
            className={`min-h-8 rounded-full px-3 whitespace-nowrap transition-colors ${
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
    </div>
  )
}
