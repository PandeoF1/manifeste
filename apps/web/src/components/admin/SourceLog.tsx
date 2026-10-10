import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { STATUS_LABELS } from '@shared/status.ts'
import { sourceLogQuery, type CollectorRun } from '@/queries/admin'

const timeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })

type Outcome = CollectorRun['collector_item_logs'][number]['outcome']

const OUTCOMES: Record<Outcome, { label: string; className: string }> = {
  rattache: { label: 'Signal créé', className: 'border-leve text-fg' },
  doublon: { label: 'Déjà enregistré', className: 'border-border text-muted' },
  non_rattache: { label: 'Lycée non identifié', className: 'border-filtrant text-filtrant' },
  certitude_faible: { label: 'Certitude trop faible', className: 'border-border text-muted' },
  aucun_fait: { label: "Lu par l'IA : aucun blocage", className: 'border-border text-muted' },
  hors_sujet: { label: 'Hors sujet (mots-clés)', className: 'border-border text-muted' },
  reporte: { label: 'Reporté au passage suivant', className: 'border-filtrant text-filtrant' },
  erreur: { label: 'Erreur', className: 'border-bloque text-bloque' },
}

/** Journal d'une source : derniers passages avec du nouveau, et le devenir de chaque élément. */
export function SourceLog({ sourceId }: { sourceId: string }) {
  const log = useQuery(sourceLogQuery(sourceId))
  const [open, setOpen] = useState<string | null>(null)

  if (log.isPending) return <div className="mt-2 h-16 animate-pulse rounded-lg bg-bg" />
  if (log.isError) return <p className="mt-2 text-sm text-bloque">Journal indisponible.</p>
  if (log.data.length === 0) {
    return (
      <p className="mt-2 text-sm text-muted">
        Aucun élément nouveau sur les 7 derniers jours (les passages sans nouveauté ne sont pas
        journalisés).
      </p>
    )
  }

  return (
    <ol className="mt-2 divide-y divide-border rounded-lg border border-border bg-bg text-sm">
      {log.data.map((run) => {
        const expanded = open === run.id
        return (
          <li key={run.id}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : run.id)}
              className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-surface"
            >
              {expanded ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronRight size={16} aria-hidden="true" />
              )}
              <time dateTime={run.ran_at} className="tabular-nums">
                {timeFmt.format(new Date(run.ran_at))}
              </time>
              <span className="text-muted">
                {run.new_items} nouveau{run.new_items > 1 ? 'x' : ''} · {run.relevant} pertinent
                {run.relevant > 1 ? 's' : ''} · {run.events} fait{run.events > 1 ? 's' : ''} IA
              </span>
              {run.reports > 0 && (
                <span className="font-semibold">
                  {run.reports} signal{run.reports > 1 ? 'aux' : ''}
                </span>
              )}
              {run.unmatched > 0 && (
                <span className="text-filtrant">
                  {run.unmatched} non rattaché{run.unmatched > 1 ? 's' : ''}
                </span>
              )}
              {run.error && (
                <span className="w-full truncate text-bloque">Erreur : {run.error}</span>
              )}
            </button>
            {expanded && (
              <ul className="space-y-1 px-3 pb-3">
                {run.collector_item_logs.length === 0 && (
                  <li className="text-muted">Aucun élément.</li>
                )}
                {run.collector_item_logs.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 text-xs ${OUTCOMES[item.outcome].className}`}
                    >
                      {OUTCOMES[item.outcome].label}
                    </span>
                    {item.school_name && (
                      <span>
                        {item.school_name}
                        {item.city ? ` (${item.city})` : ''}
                        {item.status ? ` · ${STATUS_LABELS[item.status]}` : ''}
                      </span>
                    )}
                    {item.detail && <span className="text-muted">· {item.detail}</span>}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex min-h-8 items-center gap-1 text-muted underline"
                    >
                      {item.external_id.length > 40 ? 'source' : item.external_id}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
