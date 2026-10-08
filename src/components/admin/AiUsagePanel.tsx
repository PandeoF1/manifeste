import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Cpu } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import {
  TASK_LABEL,
  byTask,
  compactTokens,
  dailyBuckets,
  parseAiUsage,
  seriesFor,
  totals,
} from '@/lib/aiUsage'
import { fmtInt, pct } from '@/lib/donneesFormat'
import { StackedBars } from './stats/StackedBars'

const RANGES = [
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 90, label: '90 jours' },
] as const

const aiUsageQuery = (days: number) => ({
  queryKey: [...queryKeys.admin.all, 'ai-usage', days],
  queryFn: async () => {
    const { data, error } = await supabase.rpc('admin_ai_usage', { p_days: days })
    if (error) throw error
    return parseAiUsage(data)
  },
  refetchInterval: 60_000,
})

/** Jour calendaire courant à Paris (« 2026-10-08 »), comme les jours renvoyés par la base. */
const parisToday = () =>
  new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date())

/** Consommation de tokens de l'IA (Gemini) : par jour et par modèle, et par tâche. */
export function AiUsagePanel() {
  const [days, setDays] = useState<number>(30)
  const usage = useQuery(aiUsageQuery(days))

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted">
          Tokens consommés par l'extraction, l'analyse des médias, la réanalyse et le rattrapage. La
          sortie comprend la réflexion, facturée au même tarif. Le prix dépend du modèle : comparer
          avec la grille de Google AI Studio.
        </p>
        <div
          className="flex rounded-lg border border-border bg-bg p-0.5 text-sm"
          role="group"
          aria-label="Période"
        >
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              aria-pressed={days === r.days}
              onClick={() => setDays(r.days)}
              className="min-h-9 rounded-md px-3 aria-pressed:bg-surface aria-pressed:font-semibold aria-pressed:shadow"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {usage.isPending && <div className="h-64 animate-pulse rounded-xl bg-surface" />}
      {usage.isError && (
        <p className="text-sm text-poor" role="alert">
          Impossible de charger la consommation : {usage.error.message}. La migration
          <code className="mx-1">ai_usage</code>est-elle appliquée (<code>supabase db push</code>) ?
        </p>
      )}
      {usage.isSuccess && usage.data.length === 0 && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">
          Rien d'enregistré sur cette période. La consommation est comptée à partir du prochain
          passage de la collecte (une fois la migration et les fonctions déployées).
        </p>
      )}
      {usage.isSuccess && usage.data.length > 0 && <AiUsageCharts rows={usage.data} days={days} />}
    </div>
  )
}

export function AiUsageCharts({
  rows,
  days,
}: {
  rows: ReturnType<typeof parseAiUsage>
  days: number
}) {
  const t = totals(rows)
  const series = seriesFor(rows.map((r) => r.model))
  const today = parisToday()
  const input = dailyBuckets(rows, series, 'prompt', days, today)
  const output = dailyBuckets(rows, series, 'output', days, today)
  const tasks = byTask(rows)

  return (
    <>
      <section aria-label="Totaux" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Tokens en entrée" value={compactTokens(t.prompt)} />
        <Tile
          label="Tokens en sortie"
          value={compactTokens(t.output)}
          hint={`dont ${pct(t.thoughts, t.output)} de réflexion`}
        />
        <Tile label="Requêtes Gemini" value={fmtInt(t.calls)} />
        <Tile
          label="Entrée par requête"
          value={t.calls ? compactTokens(t.prompt / t.calls) : '–'}
          hint={t.calls ? `${compactTokens(t.output / t.calls)} en sortie` : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="ai-in">
          <h2 id="ai-in" className="flex items-center gap-2 font-semibold">
            <Cpu size={18} aria-hidden="true" /> Entrée par jour
          </h2>
          <StackedBars
            days={input}
            series={series}
            unit="tokens en entrée"
            title="Tokens en entrée par modèle"
          />
        </section>
        <section className="card p-4" aria-labelledby="ai-out">
          <h2 id="ai-out" className="flex items-center gap-2 font-semibold">
            <Cpu size={18} aria-hidden="true" /> Sortie par jour
          </h2>
          <StackedBars
            days={output}
            series={series}
            unit="tokens en sortie"
            title="Tokens en sortie (réflexion comprise) par modèle"
          />
        </section>
      </div>

      <section aria-labelledby="ai-tasks">
        <h2 id="ai-tasks" className="font-semibold">
          Par tâche
        </h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface p-3 text-sm">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="pr-3 font-normal">Tâche</th>
                <th className="pr-3 font-normal">Requêtes</th>
                <th className="pr-3 font-normal">Entrée</th>
                <th className="pr-3 font-normal">Sortie</th>
                <th className="font-normal">dont réflexion</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((k) => (
                <tr key={k.task} className="border-t border-border">
                  <td className="py-1 pr-3">{TASK_LABEL[k.task]}</td>
                  <td className="pr-3">{fmtInt(k.calls)}</td>
                  <td className="pr-3">{fmtInt(k.prompt)}</td>
                  <td className="pr-3">{fmtInt(k.output)}</td>
                  <td>{fmtInt(k.thoughts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold tracking-wider text-muted uppercase">{label}</div>
      <p className="mt-1 text-4xl font-black tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}
