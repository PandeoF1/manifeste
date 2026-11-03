import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { z } from 'zod'
import type { MapViewState } from '@/components/map/MapView'
import { LiveFeed } from '@/components/map/LiveFeed'
import { NewSignalToasts } from '@/components/map/NewSignalToasts'
import { SchoolPanel } from '@/components/map/SchoolPanel'
import { Timeline } from '@/components/map/Timeline'
import { blockedPhrase } from '@/lib/labels'
import { HeroStats, Legend } from '@/components/status/HeroStats'
import { ShareButton } from '@/components/ShareButton'
import {
  computeStats,
  periodMobilisationQuery,
  periodStatusesQuery,
  statusesQuery,
  type SchoolStatus,
} from '@/queries/statuses'
import { timelineQuery } from '@/queries/timeline'
import { settingsQuery } from '@/queries/settings'
import { marchesQuery, mobilisationsQuery } from '@/queries/movements'
import { DEFAULT_SETTINGS, PERIODS, periodDescription, type Period } from '@/lib/periods'
import { PeriodPicker } from '@/components/status/PeriodPicker'
import { useReportsRealtime } from '@/lib/realtime'
import { useTheme } from '@/lib/theme'
import { usePanelHidden } from '@/lib/uiPrefs'
import { debounce } from '@/lib/debounce'
import { useNow } from '@/lib/useNow'
import { useMediaQuery } from '@/lib/useMediaQuery'
import {
  DEFAULT_TIMELINE_RANGE,
  TIMELINE_RANGES,
  fmtMomentShort,
  hourChoices,
  rangeStart,
  statusesAt,
  mobilisationAt,
  type TimelineRange,
} from '@/lib/timeline'

// MapLibre (~800 kB) is loaded separately: the figures and the list show before the map.
const MapView = lazy(() => import('@/components/map/MapView'))

// All of metropolitan France, framing adapted to the screen width.
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
  // Absent = live (default shared URL unchanged). "historique": the timeline to replay
  // the map, with the moment (t, milliseconds; absent = now), how long a report stays
  // (h, hours; absent = site setting) and the timeline period (r; absent = 24 h).
  periode: z
    .enum([...PERIODS, 'historique'])
    .optional()
    .catch(undefined),
  t: z.number().int().optional().catch(undefined),
  h: z.number().int().min(1).max(8784).optional().catch(undefined),
  r: z.enum(TIMELINE_RANGES).optional().catch(undefined),
})

const NONE: ReadonlyArray<SchoolStatus> = []

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  // Non-blocking preload: the page shows at once, the data arrives afterwards.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(statusesQuery)
    void context.queryClient.prefetchQuery(settingsQuery)
  },
  component: MapPage,
})

function MapPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/' })
  const theme = useTheme()
  const [sideHidden, toggleSide] = usePanelHidden('side')
  const [statsHidden, toggleStats] = usePanelHidden('stats')
  const historyMode = search.periode === 'historique'
  const period: Period =
    search.periode === undefined || search.periode === 'historique' ? 'direct' : search.periode
  const isPhone = useMediaQuery('(max-width: 767px)')
  const { data: settings = DEFAULT_SETTINGS } = useQuery(settingsQuery)
  const marches = useQuery({
    ...marchesQuery(period),
    enabled: settings.marchesOnMap && !historyMode,
  })
  const signaled = useQuery({
    ...mobilisationsQuery(period),
    enabled: settings.signaledMobilisations && !historyMode,
  })
  const {
    data: statuses = [],
    dataUpdatedAt,
    isError,
    isPending,
  } = useQuery({ ...periodStatusesQuery(period, settings), placeholderData: keepPreviousData })
  // "New signal" alerts: always on live, whatever period is shown
  // (changing period would otherwise make false new schools appear).
  const { data: live = [] } = useQuery(statusesQuery)
  useReportsRealtime()
  // History mode: moment shown (null = now), timeline period, how long a signal stays.
  const to = useNow(60_000).getTime()
  const range: TimelineRange = search.r ?? DEFAULT_TIMELINE_RANGE
  const hours = search.h ?? settings.statusTtlHours
  const from = rangeStart(range, settings, to)
  const [atState, setAtState] = useState<number | null>(search.t ?? null)
  const at = atState === null ? to : Math.min(to, Math.max(from, atState))
  const timeline = useQuery({ ...timelineQuery(settings), enabled: historyMode })
  const replayed = useMemo(
    () => (historyMode && timeline.data ? statusesAt(timeline.data, at, hours) : undefined),
    [historyMode, timeline.data, at, hours],
  )
  // Judge tiers: reported mobilisations, in addition to the counted schools (live, periods
  // and replay). Empty while tiers are off.
  const { data: mobilisationData } = useQuery({
    ...periodMobilisationQuery(period, settings),
    enabled: settings.judgeTiers && !historyMode,
    placeholderData: keepPreviousData,
  })
  const replayedMobilisation = useMemo(
    () =>
      historyMode && settings.judgeTiers && timeline.data
        ? mobilisationAt(timeline.data, at, hours)
        : undefined,
    [historyMode, settings.judgeTiers, timeline.data, at, hours],
  )
  const mobilisation = useMemo(
    () =>
      settings.judgeTiers
        ? historyMode
          ? (replayedMobilisation ?? NONE)
          : (mobilisationData ?? NONE)
        : NONE,
    [settings.judgeTiers, historyMode, replayedMobilisation, mobilisationData],
  )
  const shown = historyMode ? (replayed ?? NONE) : statuses
  const loading = historyMode ? timeline.isPending : isPending
  // The list and figures come after the map: when dragging quickly on the timeline, the map and cursor
  // stay smooth, the rest catches up once the hand calms down.
  const deferredShown = useDeferredValue(shown)

  const history = historyMode
    ? `dans les ${hours} h avant le ${fmtMomentShort(at)}`
    : period === 'direct'
      ? undefined
      : periodDescription(period, settings)
  const patchHistory = useCallback(
    (patch: { t?: number | undefined; h?: number | undefined; r?: TimelineRange | undefined }) => {
      void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
    },
    [navigate],
  )
  // During playback, the position changes several times per second: the address is written
  // only once the movement is over.
  const commitAt = useMemo(
    () => debounce((t: number | undefined) => patchHistory({ t }), 400),
    [patchHistory],
  )
  useEffect(() => () => commitAt.cancel(), [commitAt])
  const setPeriod = useCallback(
    (p: Period) => {
      // A still-pending save of the moment must not rewrite the address after leaving.
      commitAt.cancel()
      setAtState(null)
      void navigate({
        search: (prev) => ({
          ...prev,
          periode: p === 'direct' ? undefined : p,
          t: undefined,
          h: undefined,
          r: undefined,
        }),
        replace: true,
      })
    },
    [navigate, commitAt],
  )
  const openHistory = useCallback(() => {
    // We always enter in the present: the moment of a previous visit is forgotten.
    setAtState(null)
    void navigate({
      search: (prev) => ({ ...prev, periode: 'historique', t: undefined }),
      replace: true,
    })
  }, [navigate])
  const onAtChange = useCallback(
    (ms: number, commit: boolean) => {
      const atEnd = ms >= to - 60_000
      setAtState(atEnd ? null : ms)
      if (commit) commitAt(atEnd ? undefined : Math.round(ms))
    },
    [to, commitAt],
  )

  const stats = useMemo(
    () => computeStats(deferredShown, historyMode ? at : to),
    [deferredShown, historyMode, at, to],
  )
  const historyParams = [
    search.t !== undefined && `t=${search.t}`,
    search.h !== undefined && `h=${search.h}`,
    search.r !== undefined && `r=${search.r}`,
  ].filter(Boolean)
  const shareUrl = historyMode
    ? `/?${['periode=historique', ...historyParams].join('&')}`
    : period === 'direct'
      ? '/'
      : `/?periode=${period}`
  const shareText = history
    ? `${stats.blocked} établissements ont été ${blockedPhrase(2)} ${history} en France.`
    : `${stats.blocked} établissements ${blockedPhrase(stats.blocked)} en ce moment en France.`
  // In History mode, the card stays open even if the school has no signal at that moment.
  const confirmed =
    shown.find((s) => s.uai === search.uai) ??
    (historyMode ? statuses.find((s) => s.uai === search.uai) : undefined)
  const mobilisationSelected = confirmed
    ? undefined
    : mobilisation.find((s) => s.uai === search.uai)
  const selected = confirmed ?? mobilisationSelected
  const showTimeline = historyMode && !(isPhone && selected)
  const historyPicker = { active: historyMode, onSelect: openHistory }

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

  // The top bar owns the slot; it exists once the page is mounted.
  const shareSlot = useSyncExternalStore(
    () => () => {},
    () => document.getElementById('topbar-share'),
    () => null,
  )

  return (
    <main className="flex min-h-0 flex-1">
      <h1 className="sr-only">
        Map et carte des blocus de lycées et de facs en direct : les établissements bloqués en
        France
      </h1>

      {/* Desktop: side panel (figures + live feed). */}
      <aside
        aria-label="Situation et derniers signaux"
        className={`hidden w-[380px] shrink-0 flex-col border-r border-border ${sideHidden ? '' : 'md:flex'}`}
      >
        <div className="space-y-4 border-b border-border p-6">
          <HeroStats
            stats={stats}
            updatedAt={dataUpdatedAt}
            isError={isError}
            history={history}
            mobilises={mobilisation.length}
          />
          <Legend mobilisation={mobilisation.length > 0} />
        </div>
        <h2 className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">
          Derniers signaux
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <FeedSkeleton />
          ) : (
            <LiveFeed
              statuses={deferredShown}
              mobilisation={mobilisation}
              selectedUai={search.uai}
              onSelect={onSelect}
            />
          )}
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        {/* Desktop: tab to collapse or reopen the side menu. */}
        <button
          type="button"
          onClick={toggleSide}
          aria-expanded={!sideHidden}
          aria-label={sideHidden ? 'Afficher le menu latéral' : 'Masquer le menu latéral'}
          className="glass absolute top-1/2 left-0 z-20 hidden h-14 w-5 -translate-y-1/2 place-items-center rounded-r-lg border border-l-0 border-border text-muted hover:text-fg md:grid"
        >
          {sideHidden ? (
            <ChevronRight size={14} aria-hidden="true" />
          ) : (
            <ChevronLeft size={14} aria-hidden="true" />
          )}
        </button>
        <Suspense fallback={<div className="absolute inset-0 bg-bg" aria-busy="true" />}>
          <MapView
            statuses={shown}
            mobilisation={mobilisation}
            marches={marches.data}
            signaled={signaled.data}
            initialView={initialView}
            selected={selected}
            onViewChange={onViewChange}
            onSelect={onSelect}
            theme={theme}
            overseas={!historyMode}
            datasetKey={historyMode ? 'historique' : period}
          />
        </Suspense>

        {/* Desktop: period and history controls on the map, where they are expected. */}
        <div className="absolute top-4 left-8 z-10 hidden md:block">
          <PeriodPicker
            value={period}
            onChange={setPeriod}
            history={historyPicker}
            onMap
            className="text-sm"
          />
        </div>
        {/* Desktop: share button in the top bar, next to "Signaler". */}
        {shareSlot &&
          createPortal(
            <ShareButton
              url={shareUrl}
              title="Manifeste - les lycées et les facs mobilisés, en direct"
              text={shareText}
              label="Partager la carte"
              labelClassName="max-xl:sr-only"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold whitespace-nowrap hover:bg-surface"
            />,
            shareSlot,
          )}

        {/* Phone: figures overlaid, collapsible with a tab. */}
        <div className="absolute top-2 left-2 z-10 max-w-[calc(100%-4rem)] md:hidden">
          {!statsHidden && (
            <div className="glass pointer-events-none rounded-2xl border border-border px-3 py-2 shadow-2xl">
              <HeroStats
                stats={stats}
                updatedAt={dataUpdatedAt}
                isError={isError}
                history={history}
                mobilises={mobilisation.length}
                compact
                picker={
                  <PeriodPicker
                    value={period}
                    onChange={setPeriod}
                    history={historyPicker}
                    className="pointer-events-auto my-1"
                  />
                }
              />
            </div>
          )}
          <button
            type="button"
            onClick={toggleStats}
            aria-expanded={!statsHidden}
            aria-label={statsHidden ? 'Afficher les chiffres' : 'Masquer les chiffres'}
            className={`glass grid h-5 w-12 place-items-center border border-border text-muted hover:text-fg ${statsHidden ? 'rounded-lg' : 'mx-auto -mt-px rounded-b-lg border-t-0'}`}
          >
            {statsHidden ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronUp size={14} aria-hidden="true" />
            )}
          </button>
        </div>

        <NewSignalToasts statuses={live} onSelect={onSelect} />

        {/* Phone: share the map, bottom left (the Report button is on the right). */}
        {!selected && (
          <ShareButton
            url={shareUrl}
            title="Manifeste - les lycées et les facs mobilisés, en direct"
            text={shareText}
            label="Partager"
            className="glass absolute left-4 z-10 inline-flex h-12 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold shadow-2xl md:hidden"
            style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          />
        )}

        {showTimeline && (
          <div className="absolute inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(56rem,calc(100%-6rem))] md:-translate-x-1/2">
            <Timeline
              data={timeline.data}
              isPending={timeline.isPending}
              isError={timeline.isError}
              from={from}
              to={to}
              at={at}
              onAtChange={onAtChange}
              range={range}
              onRangeChange={(r) =>
                patchHistory({ r: r === DEFAULT_TIMELINE_RANGE ? undefined : r })
              }
              hours={hours}
              hourOptions={hourChoices(settings.statusTtlHours, hours)}
              onHoursChange={(h) =>
                patchHistory({ h: h === settings.statusTtlHours ? undefined : h })
              }
              onExit={() => setPeriod('direct')}
            />
          </div>
        )}

        {!loading && !(historyMode && timeline.isError) && shown.length === 0 && (
          <p
            className={`glass pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-full border border-border px-4 py-2 text-sm whitespace-nowrap shadow md:top-20 md:bottom-auto ${historyMode ? 'max-md:hidden' : 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))]'}`}
          >
            {history ? `Aucun blocus signalé ${history}` : 'Aucun blocus signalé pour le moment'}
          </p>
        )}

        {selected && (
          <SchoolPanel
            school={selected}
            mobilisation={mobilisationSelected !== undefined}
            onClose={() => onSelect(undefined)}
          />
        )}
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
