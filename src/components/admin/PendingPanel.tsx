import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, X } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import { pendingQuery } from '@/queries/admin'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

export function PendingPanel() {
  const queryClient = useQueryClient()
  const pending = useQuery(pendingQuery)
  const [cursor, setCursor] = useState(0)
  const items = pending.data ?? []
  const current = items[Math.min(cursor, items.length - 1)]

  const moderate = useMutation({
    mutationFn: async ({
      id,
      moderation,
    }: {
      id: string
      moderation: 'validated' | 'rejected'
    }) => {
      const { error } = await supabase.from('reports').update({ moderation }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.pending() })
      queryClient.setQueryData(queryKeys.admin.pending(), (old: typeof items | undefined) =>
        old?.filter((r) => r.id !== id),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pending() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
    },
  })

  // Raccourcis : j/k naviguer, v valider, r rejeter, o ouvrir la source.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)))
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0))
      else if (!current) return
      else if (e.key === 'v') moderate.mutate({ id: current.id, moderation: 'validated' })
      else if (e.key === 'r') moderate.mutate({ id: current.id, moderation: 'rejected' })
      else if (e.key === 'o') window.open(current.source_url, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, items.length, moderate])

  if (pending.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (pending.isError) return <p className="text-bloque">Erreur de chargement.</p>
  if (items.length === 0) return <p className="text-muted">Aucun signal en attente.</p>

  return (
    <div>
      <p className="text-sm text-muted">
        Raccourcis : <kbd>j</kbd>/<kbd>k</kbd> naviguer · <kbd>v</kbd> valider · <kbd>r</kbd>{' '}
        rejeter · <kbd>o</kbd> ouvrir la source
      </p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((r) => {
          const active = r.id === current?.id
          return (
            <li
              key={r.id}
              aria-current={active ? 'true' : undefined}
              className={`flex flex-wrap items-center gap-3 p-3 ${active ? 'bg-bg ring-2 ring-inset ring-accent' : ''}`}
              onClick={() => setCursor(items.indexOf(r))}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {r.schools?.name ?? r.school_uai}{' '}
                  <span className="font-normal text-muted">· {r.schools?.city}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  <StatusBadge status={r.status} />
                  <span>{dateFmt.format(new Date(r.observed_at))}</span>
                  <span>
                    {r.scrape_sources?.label ?? r.source_type} · {r.source_domain}
                  </span>
                  {r.certainty && <span>certitude {r.certainty}</span>}
                </div>
              </div>
              <a
                href={r.source_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="icon-btn"
                aria-label="Ouvrir la source"
              >
                <ExternalLink size={18} />
              </a>
              <button
                type="button"
                className="icon-btn text-leve"
                aria-label="Valider"
                onClick={() => moderate.mutate({ id: r.id, moderation: 'validated' })}
              >
                <Check size={20} />
              </button>
              <button
                type="button"
                className="icon-btn text-bloque"
                aria-label="Rejeter"
                onClick={() => moderate.mutate({ id: r.id, moderation: 'rejected' })}
              >
                <X size={20} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
