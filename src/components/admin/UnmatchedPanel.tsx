import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Link2, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import { reanalyze, unmatchedQuery, type ReanalyzeResult } from '@/queries/admin'
import { SchoolSearch } from './SchoolSearch'
import { initialQuery } from '@/lib/unmatched'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** Faits extraits par l'IA que le matching n'a pas pu rattacher à un UAI. */
export function UnmatchedPanel() {
  const queryClient = useQueryClient()
  const unmatched = useQuery(unmatchedQuery)
  const [openId, setOpenId] = useState<string | null>(null)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.unmatched() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
  }
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('unmatched_extractions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const link = useMutation({
    mutationFn: async ({ id, uai }: { id: string; uai: string }) => {
      const { error } = await supabase.rpc('link_unmatched', { p_unmatched_id: id, p_uai: uai })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setOpenId(null)
      invalidate()
    },
  })

  const [aiResult, setAiResult] = useState<ReanalyzeResult | null>(null)
  const ai = useMutation({
    mutationFn: reanalyze,
    onSuccess: (data) => {
      setAiResult(data)
      invalidate()
    },
  })

  const retry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('retry_unmatched')
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: invalidate,
  })

  if (unmatched.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (unmatched.isError) return <p className="text-bloque">Erreur de chargement.</p>
  if (unmatched.data.length === 0) return <p className="text-muted">Rien à rattacher.</p>

  return (
    <>
      <p className="text-sm text-muted">
        Faits repérés par l'IA sans lycée identifié avec certitude (nom fréquent, nom incomplet,
        ville manquante). Ouvre la source, puis rattache au bon lycée : le signal est publié
        aussitôt. Conservés 7 jours.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {retry.isPending ? 'Rattachement…' : 'Réessayer le rattachement automatique'}
        </button>
        <span className="text-sm text-muted" aria-live="polite">
          {retry.isSuccess &&
            (retry.data === 0
              ? 'Aucun nouveau rattachement possible.'
              : `${retry.data} rattaché${retry.data > 1 ? 's' : ''} automatiquement.`)}
          {retry.error && <span className="text-bloque">Échec : {retry.error.message}</span>}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Utile après l'import ou la mise à jour du référentiel des lycées.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={ai.isPending}
          onClick={() => ai.mutate(undefined)}
        >
          <Sparkles size={16} aria-hidden="true" />
          {ai.isPending ? 'Analyse en cours…' : "Réanalyser avec l'IA"}
        </button>
        <span className="text-xs text-muted">
          L'IA relit la page source et choisit parmi les lycées de la commune (un seul appel pour
          toute la liste).
        </span>
      </div>
      {ai.error && (
        <p role="alert" className="mt-2 text-sm text-bloque">
          Échec : {ai.error.message}
        </p>
      )}
      {aiResult && (
        <div className="card mt-3 text-sm" aria-live="polite">
          <p className="font-semibold">
            {aiResult.linked} rattaché{aiResult.linked > 1 ? 's' : ''} sur {aiResult.total}
            {aiResult.model ? ` · ${aiResult.model}` : ''}
          </p>
          <ul className="mt-2 space-y-1">
            {aiResult.outcomes.map((o) => (
              <li key={o.id} className={o.uai ? '' : 'text-muted'}>
                {o.school_name}
                {o.city ? ` (${o.city})` : ''} : {o.result}
              </li>
            ))}
          </ul>
        </div>
      )}
      {link.error && (
        <p role="alert" className="mt-2 text-sm text-bloque">
          Échec du rattachement : {link.error.message}
        </p>
      )}
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {unmatched.data.map((u) => (
          <li key={u.id} className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {u.school_name}{' '}
                  <span className="font-normal text-muted">· {u.city ?? 'ville inconnue'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  <StatusBadge status={u.status} />
                  <span>{dateFmt.format(new Date(u.observed_at))}</span>
                  {u.source_domain && <span>· {u.source_domain}</span>}
                </div>
                {u.context && (
                  <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-muted">
                    {u.context}
                  </p>
                )}
              </div>
              <a
                href={u.source_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="icon-btn"
                aria-label="Ouvrir la source"
              >
                <ExternalLink size={18} />
              </a>
              <button
                type="button"
                className="icon-btn"
                aria-label="Réanalyser cette ligne avec l'IA"
                title="Réanalyser avec l'IA"
                disabled={ai.isPending}
                onClick={() => ai.mutate([u.id])}
              >
                <Sparkles size={18} />
              </button>
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={openId === u.id}
                onClick={() => setOpenId(openId === u.id ? null : u.id)}
              >
                <Link2 size={16} aria-hidden="true" /> Rattacher
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Ignorer (supprimer)"
                onClick={() => remove.mutate(u.id)}
              >
                <Trash2 size={18} />
              </button>
            </div>
            {openId === u.id && (
              <SchoolSearch
                initial={initialQuery(u)}
                busy={link.isPending}
                onPick={(uai) => link.mutate({ id: u.id, uai })}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
