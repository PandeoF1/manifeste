import { useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { z } from 'zod'
import { REPORT_STATUSES, STATUS_LABELS, formatRelative } from '@shared/status.ts'
import { StatusIcon } from '@/components/status/StatusIcon'
import { statusesQuery, type SchoolStatus } from '@/queries/statuses'
import { useNow } from '@/lib/useNow'

const searchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  academie: z.string().max(80).optional().catch(undefined),
  dep: z.string().max(3).optional().catch(undefined),
  statut: z.enum(REPORT_STATUSES).optional().catch(undefined),
})

export const Route = createFileRoute('/liste')({
  validateSearch: searchSchema,
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(statusesQuery)
  },
  component: ListPage,
})

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const TEXT: Record<SchoolStatus['status'], string> = {
  bloque: 'text-bloque',
  filtrant: 'text-filtrant',
  leve: 'text-leve',
}

function ListPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/liste' })
  const { data: statuses = [], isPending, isError, refetch } = useQuery(statusesQuery)
  const now = useNow()

  const academies = useMemo(
    () =>
      [...new Set(statuses.map((s) => s.academy).filter((a): a is string => Boolean(a)))].sort(),
    [statuses],
  )
  const departments = useMemo(
    () =>
      [...new Set(statuses.map((s) => s.department).filter((d): d is string => Boolean(d)))].sort(),
    [statuses],
  )

  const filtered = useMemo(() => {
    const q = search.q ? normalize(search.q.trim()) : ''
    return statuses
      .filter((s) => !search.statut || s.status === search.statut)
      .filter((s) => !search.academie || s.academy === search.academie)
      .filter((s) => !search.dep || s.department === search.dep)
      .filter((s) => !q || normalize(`${s.name} ${s.city}`).includes(q))
      .sort((a, b) => b.last_signal_at.localeCompare(a.last_signal_at))
  }, [statuses, search])

  const set = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const hasFilters = Boolean(search.q || search.academie || search.dep || search.statut)

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-4 pb-8">
      <h1 className="text-2xl font-black">Lycées mobilisés</h1>
      <p className="text-muted">
        Tous les lycées avec un signal en cours, du plus récent au plus ancien.
      </p>

      <div className="mt-4 space-y-3" role="search">
        <label className="relative block">
          <span className="sr-only">Rechercher un lycée ou une ville</span>
          <Search
            size={18}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            className="input w-full pl-10"
            placeholder="Lycée ou ville"
            value={search.q ?? ''}
            onChange={(e) => set({ q: e.target.value || undefined })}
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
          {REPORT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={search.statut === s}
              onClick={() => set({ statut: search.statut === s ? undefined : s })}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm aria-pressed:border-fg aria-pressed:bg-surface aria-pressed:font-semibold"
            >
              <StatusIcon status={s} size={16} /> {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="field">
            Académie
            <select
              className="input"
              value={search.academie ?? ''}
              onChange={(e) => set({ academie: e.target.value || undefined })}
            >
              <option value="">Toutes</option>
              {academies.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Département
            <select
              className="input"
              value={search.dep ?? ''}
              onChange={(e) => set({ dep: e.target.value || undefined })}
            >
              <option value="">Tous</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted" aria-live="polite">
        <span>
          {filtered.length} lycée{filtered.length > 1 ? 's' : ''}
        </span>
        {hasFilters && (
          <Link
            to="/liste"
            search={{}}
            className="inline-flex min-h-11 items-center gap-1 underline"
          >
            <X size={14} aria-hidden="true" /> Effacer les filtres
          </Link>
        )}
      </div>

      {isPending && (
        <ul className="mt-2 space-y-2" aria-busy="true" aria-label="Chargement">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="h-16 animate-pulse rounded-lg bg-surface" />
          ))}
        </ul>
      )}
      {isError && (
        <div className="card mt-2 text-center">
          <p>Impossible de charger la liste.</p>
          <button type="button" className="btn-secondary mt-2" onClick={() => void refetch()}>
            Réessayer
          </button>
        </div>
      )}
      {!isPending && !isError && filtered.length === 0 && (
        <p className="card mt-2 text-center text-muted">
          {hasFilters
            ? 'Aucun lycée ne correspond à ces filtres.'
            : 'Aucun blocus signalé pour le moment.'}
        </p>
      )}
      <ol className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface empty:hidden">
        {filtered.map((s) => (
          <li key={s.uai}>
            <Link
              to="/lycee/$uai"
              params={{ uai: s.uai }}
              className="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-bg"
            >
              <StatusIcon status={s.status} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block truncate text-sm text-muted">
                  {s.city}
                  {s.department ? ` (${s.department})` : ''}
                  {s.academy ? ` · ${s.academy}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs">
                <span className={`block font-semibold ${TEXT[s.status]}`}>
                  {STATUS_LABELS[s.status]}
                </span>
                <time dateTime={s.last_signal_at} className="text-muted">
                  {formatRelative(new Date(s.last_signal_at), now)}
                </time>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </main>
  )
}
