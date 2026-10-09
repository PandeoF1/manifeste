import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Image as ImageIcon, MapPin, X } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { PhotoRedactor } from '@/components/report/PhotoRedactor'
import { loadImage, toJpeg } from '@/lib/photo'
import { queryKeys } from '@/lib/queryKeys'
import {
  approveAsModerator,
  moderate,
  originalPhotoUrl,
  pendingQueryFor,
  type Decision,
  type PendingReport,
  type StaffRole,
} from '@/queries/admin'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * File de modération. L'admin valide ou rejette ; le modérateur ne peut que valider (la base
 * refuse tout le reste, ce mode sert seulement à ne pas proposer de boutons inutiles).
 */
export function PendingPanel({ role = 'admin' }: { role?: StaffRole }) {
  const queryClient = useQueryClient()
  const moderator = role === 'moderator'
  const pending = useQuery(pendingQueryFor(moderator))
  const pendingKey = moderator ? queryKeys.admin.moderatorPending() : queryKeys.admin.pending()
  const [cursor, setCursor] = useState(0)
  const items = pending.data ?? []
  const current = items[Math.min(cursor, items.length - 1)]

  const decide = useMutation({
    mutationFn: ({ report, decision }: { report: PendingReport; decision: Decision }) => {
      if (!moderator) return moderate(report, decision)
      if (decision.kind === 'reject') throw new Error('Le rejet est réservé aux administrateurs.')
      return approveAsModerator(report, decision.photo)
    },
    onMutate: async ({ report }) => {
      await queryClient.cancelQueries({ queryKey: pendingKey })
      queryClient.setQueryData(pendingKey, (old: PendingReport[] | undefined) =>
        old?.filter((r) => r.id !== report.id),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: pendingKey })
      void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
    },
  })

  // Raccourcis (hors signalements avec photo, qui demandent une vérification visuelle) :
  // j/k naviguer, v valider, r rejeter, o ouvrir la source.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)))
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0))
      else if (!current || current.report_submissions?.photo_path) return
      else if (e.key === 'v') decide.mutate({ report: current, decision: { kind: 'validate' } })
      else if (e.key === 'r' && !moderator)
        decide.mutate({ report: current, decision: { kind: 'reject' } })
      else if (e.key === 'o' && current.source_url)
        window.open(current.source_url, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, items.length, decide, moderator])

  if (pending.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (pending.isError) return <p className="text-bloque">Erreur de chargement.</p>
  if (items.length === 0) return <p className="text-muted">Aucun signal en attente.</p>

  return (
    <div>
      <p className="text-sm text-muted">
        Raccourcis : <kbd>j</kbd>/<kbd>k</kbd> naviguer · <kbd>v</kbd> valider
        {moderator ? (
          ''
        ) : (
          <>
            {' '}
            · <kbd>r</kbd> rejeter
          </>
        )}{' '}
        · <kbd>o</kbd> ouvrir la source. Les signalements avec photo se valident à la main, après
        floutage.
        {moderator &&
          ' Tu peux valider ; un signalement à rejeter, laisse-le : un administrateur s’en charge.'}
      </p>
      {decide.error && (
        <p role="alert" className="mt-2 text-sm text-bloque">
          Échec : {decide.error.message}
        </p>
      )}
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((r) => {
          const active = r.id === current?.id
          const sub = r.report_submissions
          return (
            <li
              key={r.id}
              aria-current={active ? 'true' : undefined}
              className={`p-3 ${active ? 'bg-bg ring-2 ring-accent ring-inset' : ''}`}
              onClick={() => setCursor(items.indexOf(r))}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {r.schools?.name ?? r.school_uai}{' '}
                    <span className="font-normal text-muted">· {r.schools?.city}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                    <StatusBadge status={r.status} />
                    <span>{dateFmt.format(new Date(r.observed_at))}</span>
                    <span>
                      {r.source_type === 'utilisateur'
                        ? 'Signalement sur place'
                        : (r.scrape_sources?.label ?? r.source_type)}
                      {r.source_domain ? ` · ${r.source_domain}` : ''}
                    </span>
                    {r.certainty && <span>certitude {r.certainty}</span>}
                    {r.source_type !== 'utilisateur' && <JudgeOpinion r={r} />}
                    {sub && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={14} aria-hidden="true" /> à {sub.distance_m} m de
                        l'établissement
                      </span>
                    )}
                    {sub?.photo_path && (
                      <span className="inline-flex items-center gap-1 text-fg">
                        <ImageIcon size={14} aria-hidden="true" /> photo
                      </span>
                    )}
                  </div>
                </div>
                {r.source_url && (
                  <a
                    href={r.source_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="icon-btn"
                    aria-label="Ouvrir la source"
                  >
                    <ExternalLink size={18} />
                  </a>
                )}
                {!sub?.photo_path && (
                  <>
                    <button
                      type="button"
                      className="icon-btn text-leve"
                      aria-label="Valider"
                      onClick={() => decide.mutate({ report: r, decision: { kind: 'validate' } })}
                    >
                      <Check size={20} />
                    </button>
                    {!moderator && (
                      <button
                        type="button"
                        className="icon-btn text-bloque"
                        aria-label="Rejeter"
                        onClick={() => decide.mutate({ report: r, decision: { kind: 'reject' } })}
                      >
                        <X size={20} />
                      </button>
                    )}
                  </>
                )}
              </div>
              {active && sub?.photo_path && (
                <PhotoReview
                  path={sub.photo_path}
                  busy={decide.isPending}
                  canReject={!moderator}
                  onDecide={(decision) => decide.mutate({ report: r, decision })}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PhotoReview({
  path,
  busy,
  canReject,
  onDecide,
}: {
  path: string
  busy: boolean
  canReject: boolean
  onDecide: (d: Decision) => void
}) {
  const original = useQuery({
    queryKey: ['admin', 'photo', path],
    queryFn: async () => {
      const res = await fetch(await originalPhotoUrl(path))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return loadImage(await res.blob())
    },
    staleTime: 4 * 60_000,
    gcTime: 0,
  })
  const [redacted, setRedacted] = useState<HTMLCanvasElement | null>(null)
  const onChange = useCallback((c: HTMLCanvasElement) => setRedacted(c), [])

  if (original.isPending) return <div className="mt-3 h-48 animate-pulse rounded-lg bg-surface" />
  if (original.isError)
    return <p className="mt-3 text-sm text-bloque">Photo introuvable (déjà purgée ?).</p>

  return (
    <div className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
      <PhotoRedactor image={original.data} onChange={onChange} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !redacted}
          onClick={async () =>
            redacted && onDecide({ kind: 'validate', photo: await toJpeg(redacted) })
          }
        >
          <Check size={18} /> Valider et publier la photo floutée
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => onDecide({ kind: 'validate' })}
        >
          Valider sans publier la photo
        </button>
        {canReject && (
          <button
            type="button"
            className="btn-secondary text-bloque"
            disabled={busy}
            onClick={() => onDecide({ kind: 'reject' })}
          >
            <X size={18} /> Rejeter
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Vérifie qu'aucun visage, plaque ou signe distinctif n'est reconnaissable. Dans tous les cas,
        l'original est supprimé définitivement{canReject ? '' : ' (dans l’heure)'}.
      </p>
    </div>
  )
}

/** Avis du juge (Jev) sur le signalement : probabilité que le texte dise bien « bloqué » et nature. */
function JudgeOpinion({ r }: { r: PendingReport }) {
  if (r.judge_score === null)
    return <span>Jev : {r.judged_at ? 'article illisible ou trop court' : 'pas encore jugé'}</span>
  const pct = Math.round(r.judge_score * 100)
  return (
    <span className="font-medium text-fg">
      Jev : {pct} %{r.judge_nature ? ` · ${r.judge_nature}` : ''}
    </span>
  )
}
