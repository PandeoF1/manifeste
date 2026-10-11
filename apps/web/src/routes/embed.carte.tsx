import { lazy, Suspense, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { blockedPhrase } from '@/lib/labels'
import { computeStats, statusesQuery } from '@/queries/statuses'
import { fmtInt } from '@/lib/donneesFormat'
import { useReportsRealtime } from '@/lib/realtime'
import { useTheme } from '@/lib/theme'
import type { MapViewState } from '@/components/map/MapView'

const MapView = lazy(() => import('@/components/map/MapView'))

export const Route = createFileRoute('/embed/carte')({
  component: EmbedCarte,
})

const VIEW: MapViewState = { lat: 46.6, lng: 2.4, z: 4.6 }

/** The map alone, to embed on another site (iframe). A click opens the school page in a tab. */
function EmbedCarte() {
  const { data: statuses = [] } = useQuery(statusesQuery)
  const theme = useTheme()
  useReportsRealtime()
  const stats = computeStats(statuses)
  const onSelect = useCallback((uai: string | undefined) => {
    if (uai) window.open(`/lycee/${uai}`, '_blank', 'noopener')
  }, [])
  const onViewChange = useCallback(() => undefined, [])
  return (
    <main className="relative flex min-h-0 flex-1">
      <h1 className="sr-only">Carte des lycées et des facs bloqués en France, en direct</h1>
      <div className="relative min-w-0 flex-1">
        <Suspense fallback={<div className="absolute inset-0 bg-bg" aria-busy="true" />}>
          <MapView
            statuses={statuses}
            initialView={VIEW}
            selected={undefined}
            onViewChange={onViewChange}
            onSelect={onSelect}
            theme={theme}
          />
        </Suspense>
        <p className="glass pointer-events-none absolute top-2 left-2 z-10 rounded-xl border border-border px-3 py-2 text-sm shadow">
          <strong className="text-lg tabular-nums">{fmtInt(stats.blocked)}</strong>{' '}
          {blockedPhrase(stats.blocked)} en ce moment
        </p>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="glass absolute bottom-2 left-2 z-10 rounded-full border border-border px-3 py-1.5 text-xs font-semibold shadow"
        >
          Manifeste
        </a>
      </div>
    </main>
  )
}
