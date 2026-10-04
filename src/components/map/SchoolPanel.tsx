import { useQuery } from '@tanstack/react-query'
import { X, ExternalLink } from 'lucide-react'
import { formatRelative } from '@shared/status.ts'
import { StatusBadge } from '@/components/status/StatusBadge'
import { schoolReportsQuery, type SchoolStatus } from '@/queries/statuses'

const SOURCE_TYPE_LABEL = {
  presse: 'Presse',
  syndicat: 'Syndicat',
  utilisateur: 'Signalement',
  collecteur: 'Collecte automatique',
} as const

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export function SchoolPanel({ school, onClose }: { school: SchoolStatus; onClose: () => void }) {
  const reports = useQuery(schoolReportsQuery(school.uai))
  const last = new Date(school.last_signal_at)

  return (
    <section
      aria-labelledby="school-panel-title"
      className="absolute inset-x-0 bottom-0 z-10 max-h-[60vh] overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 shadow-xl md:inset-x-auto md:bottom-auto md:left-4 md:top-4 md:w-96 md:rounded-2xl"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="school-panel-title" className="text-lg font-bold leading-tight">
            {school.name}
          </h2>
          <p className="text-sm text-muted">
            {school.city}
            {school.department ? ` (${school.department})` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-m-2 grid size-12 shrink-0 place-items-center rounded-full hover:bg-bg"
          aria-label="Fermer"
        >
          <X size={20} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge status={school.status} />
        <span className="text-sm text-muted">
          dernier signal à {timeFmt.format(last)} ({formatRelative(last)}) · {school.source_count}{' '}
          {school.source_count > 1 ? 'sources' : 'source'}
        </span>
      </div>

      <h3 className="mt-4 text-sm font-semibold">Sources (24 h)</h3>
      {reports.isPending && (
        <ul className="mt-2 space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <li key={i} className="h-10 animate-pulse rounded-md bg-bg" />
          ))}
        </ul>
      )}
      {reports.isError && (
        <p className="mt-2 text-sm text-bloque">
          Impossible de charger les sources. Réessayez plus tard.
        </p>
      )}
      {reports.data && reports.data.length === 0 && (
        <p className="mt-2 text-sm text-muted">Aucune source sur les dernières 24 h.</p>
      )}
      {reports.data && reports.data.length > 0 && (
        <ol className="mt-2 divide-y divide-border">
          {reports.data.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <time dateTime={r.observed_at} className="tabular-nums">
                    {timeFmt.format(new Date(r.observed_at))}
                  </time>
                  <StatusBadge status={r.status} />
                </div>
                <div className="truncate text-muted">
                  {SOURCE_TYPE_LABEL[r.source_type]} · {r.source_domain}
                </div>
              </div>
              <a
                href={r.source_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-bg"
                aria-label={`Ouvrir la source (${r.source_domain})`}
              >
                <ExternalLink size={18} />
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
