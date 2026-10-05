import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { searchSchoolsQuery } from '@/queries/report'

/** Recherche d'un lycée du référentiel (nom, ville) avec choix en un clic. */
export function SchoolSearch({
  initial,
  busy,
  onPick,
  actionLabel = 'Ce lycée',
}: {
  initial: string
  busy: boolean
  onPick: (uai: string, name: string) => void
  actionLabel?: string
}) {
  const [query, setQuery] = useState(initial)
  const results = useQuery(searchSchoolsQuery(query))

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-bg p-3">
      <label className="relative block">
        <span className="sr-only">Chercher le lycée</span>
        <Search
          size={16}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          autoFocus
          className="input w-full pl-9"
          placeholder="Nom du lycée, ville"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {query.trim().length < 2 && <p className="text-sm text-muted">Tape au moins 2 caractères.</p>}
      {results.isFetching && <div className="h-10 animate-pulse rounded bg-surface" />}
      {results.data?.length === 0 && (
        <p className="text-sm text-muted">
          Aucun lycée trouvé. Essaie avec moins de mots (juste la ville, ou juste le nom).
        </p>
      )}
      <ul className="divide-y divide-border">
        {results.data?.map((s) => (
          <li key={s.uai} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block text-sm text-muted">
                {s.city}
                {s.department ? ` (${s.department})` : ''} · {s.uai}
              </span>
            </span>
            <button
              type="button"
              className="btn-primary min-h-10 px-3 text-sm"
              disabled={busy}
              onClick={() => onPick(s.uai, `${s.name} (${s.city})`)}
            >
              <Check size={16} aria-hidden="true" /> {actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
