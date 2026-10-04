import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import { unmatchedQuery } from '@/queries/admin'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** Faits extraits par l'IA que le matching n'a pas pu rattacher à un UAI. */
export function UnmatchedPanel() {
  const queryClient = useQueryClient()
  const unmatched = useQuery(unmatchedQuery)
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('unmatched_extractions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.unmatched() }),
  })

  if (unmatched.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (unmatched.isError) return <p className="text-bloque">Erreur de chargement.</p>
  if (unmatched.data.length === 0) return <p className="text-muted">Rien à rattacher.</p>

  return (
    <>
      <p className="text-sm text-muted">
        Conservés 7 jours. Un nom fréquent sans ville (ex. « Victor-Hugo ») n'est jamais rattaché
        automatiquement.
      </p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {unmatched.data.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {u.school_name}{' '}
                <span className="font-normal text-muted">· {u.city ?? 'ville inconnue'}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                <StatusBadge status={u.status} />
                <span>{dateFmt.format(new Date(u.observed_at))}</span>
              </div>
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
              aria-label="Supprimer"
              onClick={() => remove.mutate(u.id)}
            >
              <Trash2 size={18} />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
