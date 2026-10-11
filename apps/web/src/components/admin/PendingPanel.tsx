import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Image as ImageIcon, MapPin, X } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { PhotoRedactor } from '@/components/report/PhotoRedactor'
import type { StaffRole } from '@/lib/auth'
import { ORIGIN_LABELS } from '@/lib/labels'
import { loadImage, toJpeg } from '@/lib/photo'
import { queryKeys } from '@/lib/queryKeys'
import { decideReport, originalPhotoUrl, pendingQuery, type PendingReport } from '@/queries/admin'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

type Decision = { kind: 'approve'; photo?: Blob } | { kind: 'reject' }

/** Moderation queue. Moderators and admins both approve and reject; the server audits every decision. */
export function PendingPanel({ role = 'admin' }: { role?: StaffRole }) {
  const queryClient = useQueryClient()
  const pending = useQuery(pendingQuery)
  const [cursor, setCursor] = useState(0)
  const items = pending.data ?? []
  const current = items[Math.min(cursor, items.length - 1)]

  const decide = useMutation({
    mutationFn: ({ report, decision }: { report: PendingReport; decision: Decision }) =>
      decideReport(
        report.id,
        decision.kind,
        decision.kind === 'approve' ? decision.photo : undefined,
      ),
    onMutate: async ({ report }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.pending() })
      queryClient.setQueryData(queryKeys.admin.pending(), (old: PendingReport[] | undefined) =>
        old?.filter((r) => r.id !== report.id),
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pending() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
    },
  })

  // Shortcuts (except reports with a photo, which need a visual check):
  // j/k navigate, v validate, r reject, o open the source.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)))
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0))
      else if (!current || current.hasPhoto) return
      else if (e.key === 'v') decide.mutate({ report: current, decision: { kind: 'approve' } })
      else if (e.key === 'r') decide.mutate({ report: current, decision: { kind: 'reject' } })
      else if (e.key === 'o' && current.sourceUrl)
        window.open(current.sourceUrl, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, items.length, decide])

  if (pending.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (pending.isError) return <p className="text-bloque">Erreur de chargement.</p>
  if (items.length === 0) return <p className="text-muted">Aucun signal en attente.</p>

  return (
    <div>
      <p className="text-sm text-muted">
        Raccourcis : <kbd>j</kbd>/<kbd>k</kbd> naviguer · <kbd>v</kbd> valider · <kbd>r</kbd>{' '}
        rejeter · <kbd>o</kbd> ouvrir la source. Les signalements avec photo se valident à la main,
        après floutage.
        {role === 'moderator' && ' Chaque décision est enregistrée dans le journal.'}
      </p>
      {decide.error && (
        <p role="alert" className="mt-2 text-sm text-bloque">
          Échec : {decide.error.message}
        </p>
      )}
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((r) => {
          const active = r.id === current?.id
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
                    {r.schoolName ?? r.schoolUai}{' '}
                    <span className="font-normal text-muted">· {r.schoolCity}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                    <StatusBadge status={r.status} />
                    <span>{dateFmt.format(r.observedAt)}</span>
                    <span>
                      {r.origin === 'on_site'
                        ? 'Signalement sur place'
                        : (r.sourceLabel ?? ORIGIN_LABELS[r.origin])}
                      {r.sourceDomain ? ` · ${r.sourceDomain}` : ''}
                    </span>
                    {r.certainty && <span>certitude {r.certainty}</span>}
                    {r.origin !== 'on_site' && <JudgeOpinion r={r} />}
                    {r.distanceM !== null && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={14} aria-hidden="true" /> à {r.distanceM} m de l'établissement
                      </span>
                    )}
                    {r.hasPhoto && (
                      <span className="inline-flex items-center gap-1 text-fg">
                        <ImageIcon size={14} aria-hidden="true" /> photo
                      </span>
                    )}
                  </div>
                </div>
                {r.sourceUrl && (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="icon-btn"
                    aria-label="Ouvrir la source"
                  >
                    <ExternalLink size={18} />
                  </a>
                )}
                {!r.hasPhoto && (
                  <>
                    <button
                      type="button"
                      className="icon-btn text-leve"
                      aria-label="Valider"
                      onClick={() => decide.mutate({ report: r, decision: { kind: 'approve' } })}
                    >
                      <Check size={20} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn text-bloque"
                      aria-label="Rejeter"
                      onClick={() => decide.mutate({ report: r, decision: { kind: 'reject' } })}
                    >
                      <X size={20} />
                    </button>
                  </>
                )}
              </div>
              {active && r.hasPhoto && (
                <PhotoReview
                  id={r.id}
                  busy={decide.isPending}
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
  id,
  busy,
  onDecide,
}: {
  id: string
  busy: boolean
  onDecide: (d: Decision) => void
}) {
  const original = useQuery({
    queryKey: ['admin', 'photo', id],
    queryFn: async () => {
      const res = await fetch(originalPhotoUrl(id), { credentials: 'include' })
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
            redacted && onDecide({ kind: 'approve', photo: await toJpeg(redacted) })
          }
        >
          <Check size={18} /> Valider et publier la photo floutée
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => onDecide({ kind: 'approve' })}
        >
          Valider sans publier la photo
        </button>
        <button
          type="button"
          className="btn-secondary text-bloque"
          disabled={busy}
          onClick={() => onDecide({ kind: 'reject' })}
        >
          <X size={18} /> Rejeter
        </button>
      </div>
      <p className="text-xs text-muted">
        Vérifie qu'aucun visage, plaque ou signe distinctif n'est reconnaissable. Dans tous les cas,
        l'original est supprimé définitivement.
      </p>
    </div>
  )
}

/** The judge's opinion on the report: probability that the text really says "blocked", and nature. */
function JudgeOpinion({ r }: { r: PendingReport }) {
  if (!r.judge || r.judge.probability === null)
    return <span>Jev : pas d’avis (texte trop court, ou pas encore jugé)</span>
  const pct = Math.round(r.judge.probability * 100)
  return (
    <span className="font-medium text-fg">
      Jev : {pct} %{r.judge.nature ? ` · ${r.judge.nature}` : ''}
    </span>
  )
}
