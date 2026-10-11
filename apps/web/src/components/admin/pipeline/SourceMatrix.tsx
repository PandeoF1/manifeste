import type { Source } from '@/queries/admin'

const COLOR: Record<Source['health'], string> = {
  closed: 'var(--good)',
  half_open: 'var(--warn)',
  open: 'var(--poor)',
}

/** One square per source: green is healthy, amber is on trial, red is paused by the breaker, grey is off. */
export function SourceMatrix({ sources }: { sources: readonly Source[] }) {
  return (
    <div>
      <ul className="flex flex-wrap gap-1" aria-label="Santé des sources">
        {sources.map((s) => {
          const color = s.enabled ? COLOR[s.health] : 'var(--border)'
          const text = `${s.label} · ${s.enabled ? s.health : 'désactivée'}${s.lastError ? ` · ${s.lastError}` : ''}`
          return (
            <li key={s.id} title={text}>
              <span
                role="img"
                aria-label={text}
                className="block size-3.5 rounded-sm"
                style={{
                  background: color,
                  opacity: s.enabled && s.stats.relevant24h === 0 ? 0.55 : 1,
                }}
              />
            </li>
          )
        })}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
        <Key color="var(--good)" label="sain" />
        <Key color="var(--warn)" label="essai" />
        <Key color="var(--poor)" label="en pause" />
        <Key color="var(--border)" label="désactivée" />
        <span>· estompé : rien de pertinent en 24 h</span>
      </p>
    </div>
  )
}

const Key = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1">
    <span className="size-2.5 rounded-sm" style={{ background: color }} /> {label}
  </span>
)
