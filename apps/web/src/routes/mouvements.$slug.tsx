import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { SLUG_PATTERN } from '@manifeste/core'
import {
  EVENT_KIND_LABEL,
  EVENT_STATUS_COLOR,
  EVENT_STATUS_LABEL,
  groupByDay,
  ROUTE_BASIS_LABEL,
  routeLengthLabel,
  shownStatus,
  type MovementEvent,
} from '@/lib/movements'
import { useNow } from '@/lib/useNow'
import { useTheme } from '@/lib/theme'
import { movementQuery } from '@/queries/movements'
import { settingsQuery } from '@/queries/settings'

const MovementMap = lazy(() => import('@/components/movement/MovementMap'))

export const Route = createFileRoute('/mouvements/$slug')({
  params: {
    parse: ({ slug }) => {
      if (!SLUG_PATTERN.test(slug)) throw notFound()
      return { slug }
    },
  },
  loader: async ({ context, params }) => {
    // Hidden until the setting is on: the page then does not exist.
    const settings = await context.queryClient.ensureQueryData(settingsQuery)
    if (!settings.movementsPublic) throw notFound()
    const found = await context.queryClient.ensureQueryData(movementQuery(params.slug))
    if (!found) throw notFound()
  },
  pendingComponent: () => (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-4" aria-busy="true">
      <div className="h-10 w-3/4 animate-pulse rounded bg-surface" />
      <div className="h-32 animate-pulse rounded-lg bg-surface" />
    </main>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-black">Page introuvable</h1>
    </main>
  ),
  errorComponent: ({ reset }) => (
    <main className="mx-auto max-w-2xl p-6">
      <p>Impossible de charger ce mouvement.</p>
      <button type="button" className="btn-secondary mt-3" onClick={reset}>
        Réessayer
      </button>
    </main>
  ),
  component: MovementPage,
})

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const dayKey = (d: Date) => dayFmt.format(d)

function MovementPage() {
  const { slug } = Route.useParams()
  const { data } = useSuspenseQuery(movementQuery(slug))
  const now = useNow()
  const theme = useTheme()
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const movement = data?.movement
  const events = useMemo<MovementEvent[]>(() => data?.events ?? [], [data])
  const days = useMemo(() => groupByDay(events, dayKey), [events])

  useEffect(() => {
    if (!movement) return
    document.title = `${movement.name} - Manifeste`
    return () => {
      document.title = 'Map des blocus : lycées et facs bloqués en direct - Manifeste'
    }
  }, [movement])

  if (!movement) return null
  const period = movement.endsAt
    ? `${dateFmt.format(movement.startsAt)} - ${dateFmt.format(movement.endsAt)}`
    : `Depuis le ${dateFmt.format(movement.startsAt)}`

  return (
    <main className="flex min-h-0 flex-1 flex-col md:flex-row">
      <section
        aria-label="Le mouvement et ses événements"
        className="order-2 flex min-h-0 flex-1 flex-col overflow-y-auto border-border md:order-1 md:w-[400px] md:flex-none md:border-r"
      >
        <header className="space-y-2 border-b border-border p-4">
          <Link
            to="/mouvements"
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
          >
            <ArrowLeft size={14} aria-hidden="true" /> Tous les mouvements
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-black">
            {movement.name}
            {movement.status === 'archived' && (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs font-bold text-muted">
                Archivé
              </span>
            )}
          </h1>
          <p className="text-sm text-muted">
            {period} · {movement.eventCount} événement{movement.eventCount > 1 ? 's' : ''}
          </p>
          {movement.description && <p>{movement.description}</p>}
        </header>

        {events.length === 0 ? (
          <p className="p-4 text-muted">Aucun événement publié pour l'instant.</p>
        ) : (
          <div className="space-y-4 p-4">
            {days.map((group) => (
              <section key={group.day} aria-label={group.day} className="space-y-2">
                <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">
                  {group.day}
                </h2>
                <ul className="space-y-2">
                  {group.events.map((e) => (
                    <EventRow
                      key={e.id}
                      e={e}
                      now={now}
                      selected={e.id === selectedId}
                      onSelect={() => setSelectedId(e.id === selectedId ? undefined : e.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      <div className="relative order-1 h-[45dvh] shrink-0 md:order-2 md:h-auto md:min-w-0 md:flex-1">
        <Suspense fallback={<div className="absolute inset-0 bg-bg" aria-busy="true" />}>
          <MovementMap
            events={events}
            now={now}
            theme={theme}
            selectedId={selectedId}
            onSelect={setSelectedId}
            datasetKey={movement.slug}
          />
        </Suspense>
      </div>
    </main>
  )
}

function EventRow({
  e,
  now,
  selected,
  onSelect,
}: {
  e: MovementEvent
  now: Date
  selected: boolean
  onSelect: () => void
}) {
  const status = shownStatus(e, now)
  const length = routeLengthLabel(e)
  return (
    <li>
      <div
        className={`rounded-xl border bg-surface p-3 ${selected ? 'border-fg' : 'border-border'}`}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="w-full text-left"
        >
          <span className="flex items-center gap-2 text-xs font-bold">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: EVENT_STATUS_COLOR[status] }}
            />
            {EVENT_STATUS_LABEL[status]}
            <span className="font-normal text-muted">· {EVENT_KIND_LABEL[e.kind]}</span>
          </span>
          <span className="mt-1 block font-bold">{e.title}</span>
          <span className="block text-sm text-muted">
            {timeFmt.format(e.startsAt)}
            {e.endsAt ? ` - ${timeFmt.format(e.endsAt)}` : ''}
            {e.place ? ` · ${e.place}` : ''}
          </span>
        </button>
        {e.route && e.routeBasis && (
          <p className="mt-1 text-xs text-muted">
            {ROUTE_BASIS_LABEL[e.routeBasis]}
            {length ? ` · ${length}` : ''}
          </p>
        )}
        {e.sourceUrl && e.sourceDomain && (
          <a
            href={e.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs underline"
          >
            <ExternalLink size={12} aria-hidden="true" /> {e.sourceDomain}
          </a>
        )}
      </div>
    </li>
  )
}
