import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { pipelineEventsQuery } from '@/queries/admin'

const STAGES = [
  '',
  'discover',
  'relevance',
  'read',
  'dedupe',
  'extract',
  'match',
  'date',
  'store',
  'media',
  'run',
  'job',
] as const
const timeFmt = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const outcomeClass = (outcome: string) =>
  /fail|error/.test(outcome)
    ? 'text-poor'
    : /defer|unreadable|unmatched|skipped|stale|weekend|low/.test(outcome)
      ? 'text-warn'
      : /reported|ok|extracted|completed/.test(outcome)
        ? 'text-good'
        : 'text-muted'

/** The pipeline's log, newest first, like a terminal: time, stage, outcome and what the step noted. */
export function EventTail() {
  const [stage, setStage] = useState('')
  const events = useQuery(pipelineEventsQuery(stage || undefined))
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filtrer par étape">
        {STAGES.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            aria-pressed={stage === s}
            onClick={() => setStage(s)}
            className="rounded-full border border-border px-2.5 py-1 text-xs aria-pressed:border-fg aria-pressed:bg-surface aria-pressed:font-semibold"
          >
            {s || 'tout'}
          </button>
        ))}
      </div>
      <div
        className="max-h-96 overflow-y-auto rounded-lg bg-[#0b0e14] p-3 font-mono text-xs leading-relaxed text-[#c9d1d9]"
        role="log"
        aria-live="off"
      >
        {events.isPending && <p>…</p>}
        {events.data?.length === 0 && <p>Aucun événement.</p>}
        {events.data?.map((e) => (
          <div key={e.id} className="whitespace-pre-wrap">
            <span className="text-[#6e7681]">{timeFmt.format(e.at)}</span>{' '}
            <span className="text-[#79c0ff]">{e.stage.padEnd(9)}</span>{' '}
            <span className={outcomeClass(e.outcome)}>{e.outcome}</span>
            {e.durationMs != null && <span className="text-[#6e7681]"> {e.durationMs} ms</span>}
            {e.detail != null && (
              <span className="text-[#8b949e]"> {JSON.stringify(e.detail).slice(0, 160)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
