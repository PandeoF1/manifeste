import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { queryKeys } from '@/lib/queryKeys'
import { useStaffSocket } from '@/lib/staffSocket'
import { aiStatusQuery, pipelineOverviewQuery, runPipelineNow, sourcesQuery } from '@/queries/admin'
import { OperationButton } from '../OperationButton'
import { EventTail } from './EventTail'
import { FlowDiagram } from './FlowDiagram'
import { Funnel } from './Funnel'
import { Lanes } from './Lanes'
import { SourceMatrix } from './SourceMatrix'
import { Latency } from './Latency'
import { Throughput } from './Throughput'

const usd = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

/** The ingestion pipeline at a glance: flow, funnel, lanes, source health, throughput, log, operations. */
export function PipelineTab() {
  const queryClient = useQueryClient()
  useStaffSocket()
  const overview = useQuery(pipelineOverviewQuery)
  const sources = useQuery(sourcesQuery)
  const ai = useQuery(aiStatusQuery)
  const run = useMutation({
    mutationFn: runPipelineNow,
    onSuccess: () =>
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }), 4000),
  })

  if (overview.isPending) return <div className="h-64 animate-pulse rounded-xl bg-surface" />
  if (overview.isError)
    return (
      <p role="alert" className="text-bloque">
        Impossible de charger le pipeline : {overview.error.message}
      </p>
    )
  const o = overview.data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted">
          Chaque ligne d'événement est une étape réelle (découverte, lecture, extraction,
          rattachement). Rafraîchi en direct ; les chiffres couvrent les dernières 24 heures.
        </p>
        <button
          type="button"
          className="btn-secondary"
          disabled={run.isPending}
          onClick={() => run.mutate()}
        >
          <Play size={16} aria-hidden="true" /> Tout lancer maintenant
        </button>
      </div>

      {ai.data && (
        <p
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm"
          aria-label="État de l'IA"
        >
          <span className={ai.data.enabled ? 'text-good' : 'font-semibold text-bloque'}>
            IA {ai.data.enabled ? 'active' : 'COUPÉE'}
          </span>
          <span className="text-muted">
            modèle : {ai.data.extractModels[0]?.model ?? '–'}
            {ai.data.extractModels.length > 1
              ? ` (+${ai.data.extractModels.length - 1} de secours)`
              : ''}
          </span>
          <span className="text-muted">prompt {ai.data.extractPrompt}</span>
          <span className="text-muted">
            juge : {ai.data.judge === 'off' ? 'coupé' : ai.data.judge}
          </span>
          <span className="tabular-nums text-muted">
            dépense du jour : {usd.format(ai.data.spentTodayUsd)}
            {ai.data.dailyBudgetUsd > 0
              ? ` / ${usd.format(ai.data.dailyBudgetUsd)}`
              : ' (sans plafond)'}
          </span>
        </p>
      )}

      <section className="card p-3" aria-label="Circuit">
        <FlowDiagram overview={o} />
        <ul
          className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
          aria-label="Files d'attente"
        >
          {o.queues.map((q) => (
            <li key={q.name} className="tabular-nums">
              <code>{q.name.replace('ingest.', '')}</code> : {q.queued} en file · {q.active} actif
              {q.failed > 0 && <span className="text-poor"> · {q.failed} en échec</span>}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="funnel-title">
          <h2 id="funnel-title" className="mb-2 font-semibold">
            Entonnoir
          </h2>
          <Funnel funnel={o.funnel} />
        </section>
        <section aria-labelledby="matrix-title">
          <h2 id="matrix-title" className="mb-2 font-semibold">
            Santé des sources
          </h2>
          {sources.data ? (
            <SourceMatrix sources={sources.data} />
          ) : (
            <div className="h-12 animate-pulse rounded bg-bg" />
          )}
        </section>
      </div>

      <section aria-labelledby="lanes-title">
        <h2 id="lanes-title" className="mb-2 font-semibold">
          Files à surveiller
        </h2>
        <Lanes states={o.states} />
      </section>

      <section aria-labelledby="flow-title">
        <h2 id="flow-title" className="mb-2 font-semibold">
          Débit
        </h2>
        <Throughput />
        <Latency />
      </section>

      <section aria-labelledby="log-title">
        <h2 id="log-title" className="mb-2 font-semibold">
          Journal en direct
        </h2>
        <EventTail />
      </section>

      <section aria-labelledby="ops-title" className="space-y-3">
        <h2 id="ops-title" className="font-semibold">
          Opérations
        </h2>
        <p className="text-sm text-muted">
          Chacune commence par une simulation gratuite qui dit ce qui serait fait.
        </p>
        <OperationButton
          label="Relire les sources sur 3 jours"
          body={{ kind: 'backfill', sinceHours: 72 }}
          help="Après l'ajout d'une source ou une panne."
        />
        <OperationButton
          label="Ré-analyser avec l'IA les 48 dernières heures"
          body={{ kind: 'reextract', sinceHours: 48 }}
          help="Après un changement de prompt ou de modèle."
        />
        <OperationButton
          label="Faire juger les signalements sans avis (7 jours)"
          body={{ kind: 'rejudge', sinceHours: 168 }}
          help="Le juge relit l'article et donne son second avis."
        />
      </section>
    </div>
  )
}
