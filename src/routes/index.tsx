import { useCallback, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { List, Map as MapIcon } from 'lucide-react'
import { z } from 'zod'
import { MapView, type MapViewState } from '@/components/map/MapView'
import { SchoolPanel } from '@/components/map/SchoolPanel'
import { StatusList } from '@/components/map/StatusList'
import { NationalCounter } from '@/components/status/NationalCounter'
import { countStatuses, statusesQuery } from '@/queries/statuses'
import { useReportsRealtime } from '@/lib/realtime'

// France métropolitaine par défaut.
const DEFAULT_VIEW = { lat: 46.6, lng: 2.4, z: 5 }

const searchSchema = z.object({
  lat: z.number().min(-90).max(90).optional().catch(undefined),
  lng: z.number().min(-180).max(180).optional().catch(undefined),
  z: z.number().min(0).max(20).optional().catch(undefined),
  uai: z
    .string()
    .regex(/^[0-9]{7}[A-Z]$/)
    .optional()
    .catch(undefined),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  // Préchargement non bloquant : la carte s'affiche tout de suite, les marqueurs arrivent ensuite.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(statusesQuery)
  },
  component: MapPage,
  pendingComponent: () => <div className="flex-1 animate-pulse bg-surface" aria-busy="true" />,
  errorComponent: ({ reset }) => (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p>Les données n'ont pas pu être chargées.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-accent px-4 py-3 text-accent-fg"
      >
        Réessayer
      </button>
    </main>
  ),
})

function MapPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  const { data: statuses = [], dataUpdatedAt, isError } = useQuery(statusesQuery)
  const [showList, setShowList] = useState(false)
  useReportsRealtime()

  const counts = useMemo(() => countStatuses(statuses), [statuses])
  const selected = statuses.find((s) => s.uai === search.uai)

  const initialView: MapViewState = {
    lat: search.lat ?? DEFAULT_VIEW.lat,
    lng: search.lng ?? DEFAULT_VIEW.lng,
    z: search.z ?? DEFAULT_VIEW.z,
  }

  const onViewChange = useCallback(
    (view: MapViewState) => {
      void navigate({ search: (prev) => ({ ...prev, ...view }), replace: true })
    },
    [navigate],
  )
  const onSelect = useCallback(
    (uai: string | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, uai }), replace: true })
    },
    [navigate],
  )

  return (
    <main className="relative flex flex-1 flex-col">
      <h1 className="sr-only">Carte des lycées bloqués</h1>
      <div className="z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <NationalCounter counts={counts} updatedAt={dataUpdatedAt} />
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          aria-pressed={showList}
          className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-md px-3 text-sm hover:bg-bg"
        >
          {showList ? <MapIcon size={18} /> : <List size={18} />}
          {showList ? 'Carte' : 'Liste'}
        </button>
      </div>
      {isError && (
        <p role="alert" className="z-10 bg-bloque px-4 py-2 text-sm text-white">
          Connexion impossible, les données affichées peuvent être anciennes.
        </p>
      )}
      <div className="relative flex-1">
        <MapView
          statuses={statuses}
          view={initialView}
          onViewChange={onViewChange}
          onSelect={onSelect}
        />
        {showList && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-surface">
            <StatusList
              statuses={statuses}
              onSelect={(uai) => {
                setShowList(false)
                onSelect(uai)
              }}
            />
          </div>
        )}
        {selected && !showList && (
          <SchoolPanel school={selected} onClose={() => onSelect(undefined)} />
        )}
        {statuses.length === 0 && !showList && (
          <p className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow">
            Aucun blocus signalé pour le moment
          </p>
        )}
      </div>
    </main>
  )
}
