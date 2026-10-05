import { useEffect } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ExternalLink, Map as MapIcon, Megaphone } from 'lucide-react'
import { formatRelative } from '@shared/status.ts'
import { ShareButton } from '@/components/ShareButton'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useReportsRealtime } from '@/lib/realtime'
import { useNow } from '@/lib/useNow'
import { publicPhotoUrl } from '@/lib/photoUrl'
import { schoolDetailQuery, schoolHistoryQuery, schoolStatusQuery } from '@/queries/school'

const SOURCE_TYPE_LABEL = {
  presse: 'Presse',
  syndicat: 'Syndicat',
  utilisateur: 'Sur place, vérifié',
  collecteur: 'Collecte automatique',
} as const

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export const Route = createFileRoute('/lycee/$uai')({
  params: {
    parse: ({ uai }) => {
      if (!/^[0-9]{7}[A-Z]$/.test(uai)) throw notFound()
      return { uai }
    },
  },
  loader: async ({ context, params }) => {
    const detail = await context.queryClient.ensureQueryData(schoolDetailQuery(params.uai))
    if (!detail) throw notFound()
    void context.queryClient.prefetchQuery(schoolStatusQuery(params.uai))
    void context.queryClient.prefetchQuery(schoolHistoryQuery(params.uai))
  },
  pendingComponent: () => (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 p-4" aria-busy="true">
      <div className="h-10 w-3/4 animate-pulse rounded bg-surface" />
      <div className="h-6 w-1/3 animate-pulse rounded bg-surface" />
      <div className="h-32 animate-pulse rounded-lg bg-surface" />
    </main>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-black">Lycée introuvable</h1>
      <Link to="/liste" search={{}} className="btn-secondary mt-4">
        Voir la liste
      </Link>
    </main>
  ),
  errorComponent: ({ reset }) => (
    <main className="mx-auto max-w-2xl p-6">
      <p>Impossible de charger cette fiche.</p>
      <button type="button" className="btn-secondary mt-3" onClick={reset}>
        Réessayer
      </button>
    </main>
  ),
  component: SchoolPage,
})

function SchoolPage() {
  const { uai } = Route.useParams()
  const { data: school } = useSuspenseQuery(schoolDetailQuery(uai))
  const status = useQuery(schoolStatusQuery(uai))
  const history = useQuery(schoolHistoryQuery(uai))
  const now = useNow()
  useReportsRealtime()

  const current = status.data
  useEffect(() => {
    if (!school) return
    document.title = `${school.name} (${school.city}) - Manifeste`
    return () => {
      document.title = 'Manifeste - les lycées mobilisés, en direct'
    }
  }, [school])

  if (!school) return null

  // Regroupement de l'historique par jour.
  const days = new Map<string, NonNullable<typeof history.data>>()
  for (const r of history.data ?? []) {
    const key = dayFmt.format(new Date(r.observed_at))
    days.set(key, [...(days.get(key) ?? []), r])
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-4 pb-10">
      <header className="space-y-1">
        <h1 className="text-3xl leading-tight font-black">{school.name}</h1>
        <p className="text-muted">
          {[school.postcode, school.city].filter(Boolean).join(' ')}
          {school.academy ? ` · académie de ${school.academy}` : ''}
          {school.kind ? ` · lycée ${school.kind}` : ''}
        </p>
      </header>

      <section aria-labelledby="now-title" className="card mt-5 space-y-2">
        <h2 id="now-title" className="text-sm font-semibold tracking-wider text-muted uppercase">
          En ce moment
        </h2>
        {status.isPending ? (
          <div className="h-8 w-40 animate-pulse rounded bg-bg" />
        ) : current ? (
          <>
            <p className="text-2xl">
              <StatusBadge status={current.status} />
            </p>
            <p className="text-sm text-muted">
              Dernier signal {formatRelative(new Date(current.last_signal_at), now)} (
              {timeFmt.format(new Date(current.last_signal_at))}) · {current.source_count}{' '}
              {current.source_count > 1 ? 'sources' : 'source'}
            </p>
          </>
        ) : (
          <p>Aucun signal en cours pour ce lycée.</p>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Link to="/signaler" search={{ uai }} className="btn-primary">
            <Megaphone size={18} aria-hidden="true" /> Signaler un changement
          </Link>
          <ShareButton
            url={`/lycee/${uai}`}
            title={`${school.name} - Manifeste`}
            text={
              current
                ? `${school.name} (${school.city}) : ${current.status === 'bloque' ? 'bloqué' : current.status === 'filtrant' ? 'barrage filtrant' : 'blocus levé'}.`
                : undefined
            }
          />
          {school.lat != null && school.lng != null && (
            <Link
              to="/"
              search={{ lat: school.lat, lng: school.lng, z: 13, uai }}
              className="btn-secondary"
            >
              <MapIcon size={18} aria-hidden="true" /> Sur la carte
            </Link>
          )}
        </div>
      </section>

      <section aria-labelledby="history-title" className="mt-8">
        <h2 id="history-title" className="text-xl font-black">
          Historique (7 jours)
        </h2>
        {history.isPending && <div className="mt-3 h-24 animate-pulse rounded-lg bg-surface" />}
        {history.isError && <p className="mt-3 text-bloque">Impossible de charger l'historique.</p>}
        {history.data?.length === 0 && (
          <p className="mt-3 text-muted">Aucun signal vérifié sur les 7 derniers jours.</p>
        )}
        {[...days.entries()].map(([day, reports]) => (
          <div key={day} className="mt-4">
            <h3 className="text-sm font-semibold text-muted first-letter:uppercase">{day}</h3>
            <ol className="mt-2 space-y-3 border-l-2 border-border pl-4">
              {reports.map((r) => (
                <li key={r.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute top-2 -left-[23px] size-3 rounded-full border-2 border-bg bg-border"
                  />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <time dateTime={r.observed_at} className="font-semibold tabular-nums">
                      {timeFmt.format(new Date(r.observed_at))}
                    </time>
                    <StatusBadge status={r.status} />
                    <span className="text-sm text-muted">
                      {SOURCE_TYPE_LABEL[r.source_type]}
                      {r.source_domain ? ` · ${r.source_domain}` : ''}
                    </span>
                    {r.source_url && (
                      <a
                        href={r.source_url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-11 items-center gap-1 text-sm underline"
                      >
                        Source <ExternalLink size={14} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                  {r.photo_public_path && (
                    <img
                      src={publicPhotoUrl(r.photo_public_path)}
                      alt={`Photo vérifiée et floutée, ${school.name}, ${timeFmt.format(new Date(r.observed_at))}`}
                      loading="lazy"
                      className="mt-2 max-h-80 w-full rounded-lg border border-border object-cover"
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
    </main>
  )
}
