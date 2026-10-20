import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { EVENT_STATUS_LABEL, shownStatus } from '@/lib/movements'
import { queryKeys } from '@/lib/queryKeys'
import { adminMobilisationsQuery, adminMovementsQuery, patchMovementEvent } from '@/queries/admin'

const PRECISION_LABEL = { point: 'Point', district: 'Quartier', city: 'Ville entière' } as const
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
})

/**
 * Mobilisations reported by the press all over France. They are published as soon as they are
 * placed: this page is where a wrong one (a wrong place, a false alert) is hidden.
 */
export function MobilisationsPanel() {
  const queryClient = useQueryClient()
  const list = useQuery(adminMobilisationsQuery)
  const movements = useQuery(adminMovementsQuery)
  const [showHidden, setShowHidden] = useState(true)
  const edit = useMutation({
    mutationFn: ({ id, ...body }: { id: string; hidden?: boolean; movementId?: string | null }) =>
      patchMovementEvent(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.mobilisations() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.movements.all })
    },
  })
  const now = new Date()
  const rows = (list.data ?? []).filter((e) => showHidden || !e.hidden)

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
        />
        Afficher aussi les masquées
      </label>
      {list.isPending && <p className="text-muted">Chargement…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-bloque">
          Impossible de charger les mobilisations.
        </p>
      )}
      {list.data && rows.length === 0 && (
        <p className="text-muted">
          Aucune mobilisation signalée. Vérifie que le réglage « Mobilisations signalées » est
          activé et que des sources de presse sont ajoutées.
        </p>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${ev.hidden ? 'text-muted line-through' : ''}`}>
                {ev.title}
              </p>
              <p className="text-sm text-muted">
                {dateTimeFmt.format(ev.startsAt)}
                {ev.place ? ` · ${ev.place}` : ''}
                {` · ${PRECISION_LABEL[ev.precision ?? 'point']}`}
                {` · ${EVENT_STATUS_LABEL[shownStatus(ev, now)]}`}
                {ev.hidden ? ' · masquée' : ''}
              </p>
            </div>
            {ev.sourceUrl?.startsWith('https://') && (
              <a
                className="inline-flex items-center gap-1 text-sm underline"
                href={ev.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ev.sourceDomain ?? 'Source'}
                <ExternalLink size={14} aria-hidden />
              </a>
            )}
            <select
              className="input w-auto"
              aria-label={`Mouvement de ${ev.title}`}
              value={ev.movementId ?? ''}
              onChange={(e) => edit.mutate({ id: ev.id, movementId: e.target.value || null })}
            >
              <option value="">Sans mouvement</option>
              {movements.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary"
              disabled={edit.isPending}
              onClick={() => edit.mutate({ id: ev.id, hidden: !ev.hidden })}
            >
              {ev.hidden ? 'Afficher' : 'Masquer'}
            </button>
          </li>
        ))}
      </ul>
      {edit.error && (
        <p role="alert" className="text-sm text-bloque">
          {edit.error.message}
        </p>
      )}
    </div>
  )
}
