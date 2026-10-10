import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { X, ExternalLink, FileText, Megaphone } from 'lucide-react'
import { ShareButton } from '@/components/ShareButton'
import { formatRelative } from '@shared/status.ts'
import { StatusBadge } from '@/components/status/StatusBadge'
import { SourceConfidence } from '@/components/status/SourceConfidence'
import { schoolReportsQuery, type SchoolStatus } from '@/queries/statuses'
import { publicPhotoUrl } from '@/lib/photoUrl'

const SOURCE_TYPE_LABEL = {
  presse: 'Presse',
  syndicat: 'Syndicat',
  utilisateur: 'Sur place, vérifié',
  collecteur: 'Collecte automatique',
} as const

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export function SchoolPanel({
  school,
  onClose,
  mobilisation = false,
}: {
  school: SchoolStatus
  onClose: () => void
  /** Judge tiers: the articles talk about a mobilisation without saying "blocked" or "closed". */
  mobilisation?: boolean
}) {
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
        {mobilisation ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-muted">
            <span aria-hidden="true" className="mob-dot size-3 rounded-full" />
            Mobilisation signalée
          </span>
        ) : (
          <StatusBadge status={school.status} />
        )}
        <span className="text-sm text-muted">
          dernier signal à {timeFmt.format(last)} ({formatRelative(last)})
        </span>
        <SourceConfidence count={school.source_count} />
      </div>

      {mobilisation && (
        <p className="mt-2 text-sm text-muted">
          Une mobilisation est signalée ici (rassemblement, incident…), mais les articles ne disent
          pas que l'entrée est bloquée ni que l'établissement est fermé. Elle n'est donc pas comptée
          dans les établissements bloqués.
        </p>
      )}

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
            <li key={r.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <time dateTime={r.observed_at} className="tabular-nums">
                      {timeFmt.format(new Date(r.observed_at))}
                    </time>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="truncate text-muted">
                    {SOURCE_TYPE_LABEL[r.source_type]}
                    {r.source_domain ? ` · ${r.source_domain}` : ''}
                  </div>
                </div>
                {r.source_url && (
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="grid size-12 shrink-0 place-items-center rounded-full hover:bg-bg"
                    aria-label={`Ouvrir la source (${r.source_domain ?? 'lien'})`}
                  >
                    <ExternalLink size={18} />
                  </a>
                )}
              </div>
              {r.photo_public_path && (
                <a
                  href={publicPhotoUrl(r.photo_public_path)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={publicPhotoUrl(r.photo_public_path)}
                    alt={`Photo vérifiée et floutée, ${school.name}`}
                    loading="lazy"
                    className="mt-2 max-h-56 w-full rounded-lg border border-border object-cover"
                  />
                </a>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 grid gap-2">
        <Link to="/signaler" search={{ uai: school.uai }} className="btn-primary w-full">
          <Megaphone size={18} aria-hidden="true" /> J'y suis : signaler la situation
        </Link>
        <div className="grid grid-cols-2 gap-2">
          <Link to="/lycee/$uai" params={{ uai: school.uai }} className="btn-secondary">
            <FileText size={18} aria-hidden="true" /> Fiche
          </Link>
          <ShareButton url={`/lycee/${school.uai}`} title={`${school.name} - Manifeste`} />
        </div>
      </div>
    </section>
  )
}
