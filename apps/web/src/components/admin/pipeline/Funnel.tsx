import type { Overview } from './types'

const STEPS: Array<{ key: keyof Overview['funnel']; label: string }> = [
  { key: 'discovered', label: 'Découverts' },
  { key: 'relevant', label: 'Pertinents' },
  { key: 'read', label: 'Lus' },
  { key: 'extracted', label: 'Analysés par l’IA' },
  { key: 'facts', label: 'Faits extraits' },
  { key: 'reported', label: 'Signalements' },
]

/** What survives each step over the last 24 hours. */
export function Funnel({ funnel }: { funnel: Overview['funnel'] }) {
  const top = Math.max(1, funnel.discovered)
  return (
    <ol aria-label="Entonnoir des dernières 24 heures" className="space-y-1.5">
      {STEPS.map((s, i) => {
        const value = funnel[s.key]
        const prev = i === 0 ? null : funnel[STEPS[i - 1]?.key as keyof Overview['funnel']]
        return (
          <li key={s.key} className="grid grid-cols-[9rem_1fr_6.5rem] items-center gap-2 text-sm">
            <span className="text-muted">{s.label}</span>
            <span className="h-4 overflow-hidden rounded bg-bg">
              <span
                className="block h-full rounded bg-accent"
                style={{ width: `${Math.max(1, (100 * value) / top)}%`, opacity: 1 - i * 0.1 }}
              />
            </span>
            <span className="text-right tabular-nums">
              {value}
              {prev ? (
                <span className="ml-1 text-xs text-muted">
                  ({prev ? Math.round((100 * value) / prev) : 0} %)
                </span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
