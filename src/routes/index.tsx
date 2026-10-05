import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import type { MapViewState } from '@/components/map/MapView'
import { LiveFeed } from '@/components/map/LiveFeed'
import { NewSignalToasts } from '@/components/map/NewSignalToasts'
import { SchoolPanel } from '@/components/map/SchoolPanel'
import { HeroStats, Legend } from '@/components/status/HeroStats'
import { ShareButton } from '@/components/ShareButton'
import { computeStats, periodStatusesQuery, statusesQuery } from '@/queries/statuses'
import { settingsQuery } from '@/queries/settings'
import { DEFAULT_SETTINGS, PERIODS, periodDescription, type Period } from '@/lib/periods'
import { PeriodPicker } from '@/components/status/PeriodPicker'
import { useReportsRealtime } from '@/lib/realtime'

// MapLibre (~800 ko) est chargé à part : les chiffres et la liste s'affichent avant la carte.
const MapView = lazy(() => import('@/components/map/MapView'))

// France métropolitaine entière, cadrage adapté à la largeur d'écran.
function defaultView(): MapViewState {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 768
  return narrow ? { lat: 46.4, lng: 2.4, z: 4.3 } : { lat: 46.6, lng: 2.4, z: 5.2 }
}

const searchSchema = z.object({
  lat: z.number().min(-90).max(90).optional().catch(undefined),
  lng: z.number().min(-180).max(180).optional().catch(undefined),
  z: z.number().min(0).max(20).optional().catch(undefined),
  uai: z
    .string()
    .regex(/^[0-9]{7}[A-Z]$/)
    .optional()
    .catch(undefined),
  // Absente = direct (URL partagée par défaut inchangée).
  periode: z.enum(PERIODS).optional().catch(undefined),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  // Préchargement non bloquant : la page s'affiche tout de suite, les données arrivent ensuite.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(statusesQuery)
    void context.queryClient.prefetchQuery(settingsQuery)
  },
  component: MapPage,
})

function MapPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  const period: Period = search.periode ?? 'direct'
  const { data: settings = DEFAULT_SETTINGS } = useQuery(settingsQuery)
  const {
    data: statuses = [],
    dataUpdatedAt,
    isError,
    isPending,
  } = useQuery({ ...periodStatusesQuery(period, settings), placeholderData: keepPreviousData })
  // Alertes « nouveau signal » : toujours sur le direct, quelle que soit la période affichée
  // (changer de période ferait sinon apparaître de faux nouveaux lycées).
  const { data: live = [] } = useQuery(statusesQuery)
  useReportsRealtime()
  const history = period === 'direct' ? undefined : periodDescription(period, settings)
  const setPeriod = useCallback(
    (p: Period) => {
      void navigate({
        search: (prev) => ({ ...prev, periode: p === 'direct' ? undefined : p }),
        replace: true,
      })
    },
    [navigate],
  )

  const stats = useMemo(() => computeStats(statuses), [statuses])
  const shareUrl = period === 'direct' ? '/' : `/?periode=${period}`
  const shareText = history
    ? `${stats.bloque} lycées ont été bloqués ${history} en France.`
    : `${stats.bloque} lycées bloqués en ce moment en France.`
  const selected = statuses.find((s) => s.uai === search.uai)

  const [initialView] = useState<MapViewState>(() => {
    const d = defaultView()
    return { lat: search.lat ?? d.lat, lng: search.lng ?? d.lng, z: search.z ?? d.z }
  })

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
    <main className="flex min-h-0 flex-1">
      <h1 className="sr-only">Carte en direct des lycées bloqués en France</h1>

      {/* Ordinateur : panneau latéral (chiffres + fil en direct). */}
      <aside
        aria-label="Situation et derniers signaux"
        className="hidden w-[380px] shrink-0 flex-col border-r border-border md:flex"
      >
        <div className="space-y-4 border-b border-border p-6">
          <HeroStats
            stats={stats}
            updatedAt={dataUpdatedAt}
            isError={isError}
            history={history}
            picker={<PeriodPicker value={period} onChange={setPeriod} />}
          />
          <Legend />
          <ShareButton
            url={shareUrl}
            title="Manifeste - les lycées mobilisés, en direct"
            text={shareText}
            label="Partager la carte"
          />
        </div>
        <h2 className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">
          Derniers signaux
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <FeedSkeleton />
          ) : (
            <LiveFeed statuses={statuses} selectedUai={search.uai} onSelect={onSelect} />
          )}
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <Suspense fallback={<div className="absolute inset-0 bg-bg" aria-busy="true" />}>
          <MapView
            statuses={statuses}
            initialView={initialView}
            selected={selected}
            onViewChange={onViewChange}
            onSelect={onSelect}
          />
        </Suspense>

        {/* Téléphone : chiffres en surimpression. */}
        <div className="glass pointer-events-none absolute top-2 left-2 z-10 max-w-[calc(100%-4rem)] rounded-2xl border border-border px-3 py-2 shadow-2xl md:hidden">
          <HeroStats
            stats={stats}
            updatedAt={dataUpdatedAt}
            isError={isError}
            history={history}
            compact
            picker={
              <PeriodPicker
                value={period}
                onChange={setPeriod}
                className="pointer-events-auto my-1"
              />
            }
          />
        </div>

        <NewSignalToasts statuses={live} onSelect={onSelect} />

        {/* Téléphone : partage de la carte, en bas à gauche (le bouton Signaler est à droite). */}
        {!selected && (
          <ShareButton
            url={shareUrl}
            title="Manifeste - les lycées mobilisés, en direct"
            text={shareText}
            label="Partager"
            className="glass absolute left-4 z-10 inline-flex h-12 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold shadow-2xl md:hidden"
            style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          />
        )}

        {!isPending && statuses.length === 0 && (
          <p className="glass absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 rounded-full border border-border px-4 py-2 text-sm whitespace-nowrap shadow md:top-4 md:bottom-auto">
            {history ? `Aucun blocus signalé ${history}` : 'Aucun blocus signalé pour le moment'}
          </p>
        )}

        {selected && <SchoolPanel school={selected} onClose={() => onSelect(undefined)} />}
      </div>
    </main>
  )
}

function FeedSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Chargement" className="space-y-2 p-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="h-12 animate-pulse rounded-md bg-surface" />
      ))}
    </ul>
  )
}
