import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { queryKeys } from '@/lib/queryKeys'
import { laneItemsQuery, retryItems } from '@/queries/admin'
import type { Overview } from './types'

const LANES = [
  {
    id: 'failed',
    label: 'En échec',
    help: 'Une étape a échoué trois fois : on peut réessayer.',
    retry: true,
  },
  {
    id: 'unreadable',
    label: 'Illisibles',
    help: 'Page bloquée, vide ou introuvable, sans texte de repli.',
    retry: true,
  },
  {
    id: 'deferred',
    label: 'En attente de l’IA',
    help: 'IA coupée ou budget du jour atteint : reprise automatique.',
    retry: false,
  },
] as const

/** The three places an item can wait for attention, with their size and the items themselves. */
export function Lanes({ states }: { states: Overview['states'] }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<(typeof LANES)[number]['id'] | null>(null)
  const retry = useMutation({
    mutationFn: retryItems,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }),
  })
  return (
    <div className="space-y-2">
      <ul className="grid gap-2 sm:grid-cols-3">
        {LANES.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              aria-expanded={open === l.id}
              onClick={() => setOpen(open === l.id ? null : l.id)}
              className="card w-full p-3 text-left"
            >
              <span className="text-xs font-semibold tracking-wider text-muted uppercase">
                {l.label}
              </span>
              <span
                className={`block text-3xl font-black tabular-nums ${(states[l.id] ?? 0) > 0 ? 'text-warn' : ''}`}
              >
                {states[l.id] ?? 0}
              </span>
              <span className="text-xs text-muted">{l.help}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <LaneItems
          lane={open}
          onRetry={(ids) =>
            retry.mutate(ids ? { itemIds: ids } : { states: [open as 'failed' | 'unreadable'] })
          }
          canRetry={LANES.find((l) => l.id === open)?.retry ?? false}
          busy={retry.isPending}
        />
      )}
      {retry.error && (
        <p role="alert" className="text-sm text-bloque">
          Échec : {retry.error.message}
        </p>
      )}
    </div>
  )
}

function LaneItems({
  lane,
  canRetry,
  busy,
  onRetry,
}: {
  lane: 'failed' | 'unreadable' | 'deferred'
  canRetry: boolean
  busy: boolean
  onRetry: (ids?: string[]) => void
}) {
  const items = useQuery(laneItemsQuery(lane))
  if (items.isPending) return <div className="h-16 animate-pulse rounded bg-bg" />
  if (!items.data?.length) return <p className="text-sm text-muted">Rien ici.</p>
  return (
    <div className="card p-3">
      {canRetry && (
        <button
          type="button"
          className="btn-secondary mb-2"
          disabled={busy}
          onClick={() => onRetry()}
        >
          <RotateCcw size={16} aria-hidden="true" /> Tout réessayer
        </button>
      )}
      <ul className="divide-y divide-border text-sm">
        {items.data.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-1.5">
            <span className="min-w-0 flex-1">
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="block truncate underline"
              >
                {i.url}
              </a>
              <span className="text-xs text-muted">
                {i.source} · {i.reason ?? '—'} · {i.attempts} essai{i.attempts > 1 ? 's' : ''}
              </span>
            </span>
            {canRetry && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Réessayer"
                disabled={busy}
                onClick={() => onRetry([i.id])}
              >
                <RotateCcw size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
