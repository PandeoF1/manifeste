import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { movementsQuery } from '@/queries/movements'
import { settingsQuery } from '@/queries/settings'

export const Route = createFileRoute('/mouvements/')({
  // Hidden until the setting is on: the page then does not exist.
  loader: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQuery)
    if (!settings.movementsPublic) throw notFound()
  },
  notFoundComponent: () => (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-black">Page introuvable</h1>
    </main>
  ),
  head: () => ({ meta: [{ title: 'Mouvements - Manifeste' }] }),
  component: MovementsPage,
})

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function MovementsPage() {
  const { data, isPending, isError, refetch } = useQuery(movementsQuery)
  const active = (data ?? []).filter((m) => m.status === 'active')
  const archived = (data ?? []).filter((m) => m.status === 'archived')

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 overflow-y-auto p-4 pb-28 md:pb-16">
      <header className="space-y-2 pt-4">
        <h1 className="text-3xl font-black">Mouvements</h1>
        <p className="text-lg text-muted">
          Chaque mouvement garde sa carte, ses événements et ses données. Le mouvement en cours est
          en haut ; les autres restent consultables, avec une adresse qui ne change pas.
        </p>
      </header>

      {isPending && <div className="h-24 animate-pulse rounded-lg bg-surface" aria-busy="true" />}
      {isError && (
        <p>
          Impossible de charger les mouvements.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Réessayer
          </button>
        </p>
      )}
      {data && data.length === 0 && <p className="text-muted">Aucun mouvement pour l'instant.</p>}

      {active.length > 0 && (
        <section aria-labelledby="en-cours" className="space-y-3">
          <h2 id="en-cours" className="text-sm font-semibold tracking-wider text-muted uppercase">
            En cours
          </h2>
          <ul className="space-y-3">
            {active.map((m) => (
              <MovementCard key={m.id} m={m} />
            ))}
          </ul>
        </section>
      )}
      {archived.length > 0 && (
        <section aria-labelledby="archives" className="space-y-3">
          <h2 id="archives" className="text-sm font-semibold tracking-wider text-muted uppercase">
            Archives
          </h2>
          <ul className="space-y-3">
            {archived.map((m) => (
              <MovementCard key={m.id} m={m} />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function MovementCard({
  m,
}: {
  m: {
    slug: string
    name: string
    description: string | null
    status: 'active' | 'archived'
    startsAt: Date
    endsAt: Date | null
    eventCount: number
  }
}) {
  const period = m.endsAt
    ? `${dateFmt.format(m.startsAt)} - ${dateFmt.format(m.endsAt)}`
    : `Depuis le ${dateFmt.format(m.startsAt)}`
  return (
    <li>
      <Link
        to="/mouvements/$slug"
        params={{ slug: m.slug }}
        className="block space-y-1 rounded-xl border border-border bg-surface p-4 hover:border-fg"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xl font-black">{m.name}</span>
          {m.status === 'active' && (
            <span className="rounded-full bg-bloque px-2 py-0.5 text-xs font-bold text-white">
              En cours
            </span>
          )}
        </span>
        <span className="block text-sm text-muted">
          {period} · {m.eventCount} événement{m.eventCount > 1 ? 's' : ''}
        </span>
        {m.description && <span className="block">{m.description}</span>}
      </Link>
    </li>
  )
}
