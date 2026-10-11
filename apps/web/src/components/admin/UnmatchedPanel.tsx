import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Link2, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { queryKeys } from '@/lib/queryKeys'
import { initialQuery } from '@/lib/unmatched'
import { dismissUnmatched, linkUnmatched, unmatchedQuery } from '@/queries/admin'
import { OperationButton } from './OperationButton'
import { SchoolSearch } from './SchoolSearch'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** Facts extracted by the AI that matching could not attach to a school. */
export function UnmatchedPanel({ canManage = true }: { canManage?: boolean }) {
  const queryClient = useQueryClient()
  const unmatched = useQuery(unmatchedQuery)
  const [openId, setOpenId] = useState<string | null>(null)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.unmatched() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pending() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
  }
  const remove = useMutation({ mutationFn: dismissUnmatched, onSuccess: invalidate })
  const link = useMutation({
    mutationFn: ({ id, uai }: { id: string; uai: string }) => linkUnmatched(id, uai),
    onSuccess: () => {
      setOpenId(null)
      invalidate()
    },
  })

  if (unmatched.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (unmatched.isError) return <p className="text-bloque">Erreur de chargement.</p>

  return (
    <>
      <p className="text-sm text-muted">
        Faits repérés par l'IA sans établissement identifié avec certitude (nom fréquent, nom
        incomplet, ville manquante). Ouvre la source, puis rattache au bon établissement : le
        signalement suit ensuite les règles de modération. Texte conservé 7 jours.
        {!canManage && ' Si tu ne sais pas, laisse la ligne : un administrateur la traitera.'}
      </p>
      {canManage && (
        <div className="mt-3 space-y-3">
          <OperationButton
            label="Réessayer le rattachement automatique"
            body={{ kind: 'rematch' }}
            help="Utile après l'import ou la mise à jour du référentiel des établissements."
          />
          <OperationButton
            label="Faire choisir l'IA parmi les candidats"
            body={{ kind: 'rematch', useAi: true }}
            help="L'IA relit l'extrait et choisit parmi les établissements proches (un appel pour 20 lignes)."
          />
        </div>
      )}
      {unmatched.data.length === 0 && <p className="mt-3 text-muted">Rien à rattacher.</p>}
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
                  {u.schoolName}{' '}
                  <span className="font-normal text-muted">· {u.city ?? 'ville inconnue'}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  <StatusBadge status={u.status} />
                  <span>{dateFmt.format(u.observedAt)}</span>
                  {u.sourceDomain && <span>· {u.sourceDomain}</span>}
                </div>
                {u.context && (
                  <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-muted">
                    {u.context}
                  </p>
                )}
              </div>
              <a
                href={u.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="icon-btn"
                aria-label="Ouvrir la source"
              >
                <ExternalLink size={18} />
              </a>
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={openId === u.id}
                onClick={() => setOpenId(openId === u.id ? null : u.id)}
              >
                <Link2 size={16} aria-hidden="true" /> Rattacher
              </button>
              {canManage && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Ignorer (supprimer)"
                  onClick={() => remove.mutate(u.id)}
                >
                  <Trash2 size={18} />
                </button>
              )}
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
