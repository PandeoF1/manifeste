import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Search } from 'lucide-react'
import { queryKeys } from '@/lib/queryKeys'
import { runOperation, type OperationBody } from '@/queries/admin'

const SUMMARY_LABELS: Record<string, string> = {
  sources: 'sources',
  sinceHours: 'fenêtre (h)',
  items: 'éléments',
  fromStoredText: 'depuis le texte conservé',
  refetched: 'à relire',
  unrecoverable: 'irrécupérables',
  estimatedAiCalls: 'appels IA estimés',
  reports: 'signalements',
  estimatedUsd: 'coût estimé (USD)',
  waiting: 'en attente',
  matched: 'rattachés',
  stillUnmatched: 'toujours non rattachés',
  judged: 'jugés',
  unreadable: 'illisibles',
  newItems: 'nouveaux éléments',
  relevant: 'pertinents',
  fetched: 'lus',
  failedSources: 'sources en échec',
  note: 'note',
}

/**
 * An operation on collected data in two steps: a dry run that says what would happen and costs
 * nothing, then an explicit "run". The run is queued; its outcome shows in the pipeline events.
 */
export function OperationButton({
  label,
  body,
  help,
}: {
  label: string
  body: Omit<OperationBody, 'dryRun'>
  help?: string
}) {
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<Record<string, string | number> | null>(null)
  const dry = useMutation({
    mutationFn: async () => {
      const r = await runOperation({ ...body, dryRun: true })
      if (!('summary' in r)) throw new Error('Unexpected answer')
      return r.summary
    },
    onSuccess: setPreview,
  })
  const run = useMutation({
    mutationFn: () => runOperation({ ...body, dryRun: false }),
    onSuccess: () => {
      setPreview(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
    },
  })
  const error = dry.error ?? run.error

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={dry.isPending}
          onClick={() => dry.mutate()}
        >
          <Search size={16} aria-hidden="true" /> {label}
        </button>
        {help && <span className="text-xs text-muted">{help}</span>}
      </div>
      {preview && (
        <div className="card space-y-2 p-3 text-sm" aria-live="polite">
          <p className="font-semibold">Simulation (rien n'a été modifié)</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {Object.entries(preview).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{SUMMARY_LABELS[k] ?? k}</dt>
                <dd className="tabular-nums">{String(v)}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              <Play size={16} aria-hidden="true" /> Lancer
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {run.isSuccess && !preview && (
        <p className="text-sm text-muted">
          Lancé : le résultat apparaît dans le flux d'événements du pipeline.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bloque">
          Échec : {error.message}
        </p>
      )}
    </div>
  )
}
