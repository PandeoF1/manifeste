import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ExternalLink, Hourglass, Pencil, Search, Sparkles, Trash2 } from 'lucide-react'
import { REPORT_STATUSES, STATUS_LABELS, type ReportStatus } from '@shared/status.ts'
import { StatusBadge } from '@/components/status/StatusBadge'
import { queryKeys } from '@/lib/queryKeys'
import {
  deleteReport,
  reportsQuery,
  sendBackToAi,
  updateReport,
  type AdminReport,
  type ReportPatch,
} from '@/queries/admin'
import { ActionMenu } from './ActionMenu'
import { SchoolSearch } from './SchoolSearch'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
type Moderation = AdminReport['moderation']

const MODERATION_LABELS: Record<Moderation, string> = {
  validated: 'Publié',
  pending: 'En attente',
  rejected: 'Rejeté',
}
const MODERATION_CLASS: Record<Moderation, string> = {
  validated: 'border-leve text-fg',
  pending: 'border-filtrant text-filtrant',
  rejected: 'border-border text-muted line-through',
}
const SOURCE_TYPE_LABELS: Record<AdminReport['source_type'], string> = {
  presse: 'Presse',
  syndicat: 'Syndicat',
  utilisateur: 'Sur place',
  collecteur: 'Collecte',
}

/** Value for <input type="datetime-local"> (browser local time). */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** All signals: search, filter by state, actions menu per row. */
export function ReportsPanel() {
  const queryClient = useQueryClient()
  const reports = useQuery(reportsQuery)
  const [filter, setFilter] = useState<Moderation | 'all'>('all')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
  }
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ReportPatch }) => updateReport(id, patch),
    onSuccess: () => {
      setEditing(null)
      setNotice('Signal modifié.')
      invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: deleteReport,
    onSuccess: () => {
      setNotice('Signal supprimé.')
      invalidate()
    },
  })
  const backToAi = useMutation({
    mutationFn: sendBackToAi,
    onSuccess: (res) => {
      const outcome = res.outcomes[0]
      setNotice(outcome ? `Réanalyse : ${outcome.result}` : 'Renvoyé en « Non rattachés ».')
      invalidate()
    },
    onError: invalidate,
  })
  const error = update.error ?? remove.error ?? backToAi.error

  const items = useMemo(() => {
    const query = normalize(q.trim())
    return (reports.data ?? [])
      .filter((r) => filter === 'all' || r.moderation === filter)
      .filter(
        (r) =>
          !query ||
          normalize(
            `${r.schools?.name ?? ''} ${r.schools?.city ?? ''} ${r.source_domain ?? ''}`,
          ).includes(query),
      )
  }, [reports.data, filter, q])

  const counts = useMemo(() => {
    const c: Record<Moderation | 'all', number> = { all: 0, validated: 0, pending: 0, rejected: 0 }
    for (const r of reports.data ?? []) {
      c.all++
      c[r.moderation]++
    }
    return c
  }, [reports.data])

  if (reports.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (reports.isError) return <p className="text-bloque">Erreur de chargement.</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Rechercher un signal</span>
          <Search
            size={16}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            className="input w-full pl-9"
            placeholder="Établissement, ville ou source"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div role="group" aria-label="Filtrer par état" className="flex flex-wrap gap-1">
          {(['all', 'validated', 'pending', 'rejected'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className="min-h-11 rounded-full border border-border px-3 text-sm aria-pressed:border-fg aria-pressed:bg-surface aria-pressed:font-semibold"
            >
              {f === 'all' ? 'Tous' : MODERATION_LABELS[f]} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="text-sm">
        {notice && !error && <p className="text-muted">{notice}</p>}
        {error && <p className="text-bloque">Échec : {error.message}</p>}
        {backToAi.isPending && <p className="text-muted">Réanalyse par l'IA en cours…</p>}
      </div>

      {items.length === 0 && <p className="text-muted">Aucun signal.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((r) => (
          <li key={r.id} className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {r.schools?.name ?? r.school_uai}{' '}
                  <span className="font-normal text-muted">· {r.schools?.city}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  <StatusBadge status={r.status} />
                  <span>{dateFmt.format(new Date(r.observed_at))}</span>
                  <span>
                    {r.scrape_sources?.label ?? SOURCE_TYPE_LABELS[r.source_type]}
                    {r.source_domain ? ` · ${r.source_domain}` : ''}
                  </span>
                  <span
                    className={`rounded-full border px-2 text-xs ${MODERATION_CLASS[r.moderation]}`}
                  >
                    {MODERATION_LABELS[r.moderation]}
                  </span>
                  {r.hidden && (
                    <span
                      className="rounded-full border border-border px-2 text-xs text-muted"
                      title="Source masquée : invisible sur le site public"
                    >
                      Masqué (source)
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
              <ActionMenu
                label={`Actions pour ${r.schools?.name ?? 'ce signal'}`}
                actions={[
                  {
                    label: 'Modifier',
                    icon: <Pencil size={16} aria-hidden="true" />,
                    onSelect: () => setEditing(editing === r.id ? null : r.id),
                  },
                  {
                    label: r.moderation === 'pending' ? 'Publier' : 'Remettre en modération',
                    icon: <Hourglass size={16} aria-hidden="true" />,
                    onSelect: () =>
                      update.mutate({
                        id: r.id,
                        patch: { moderation: r.moderation === 'pending' ? 'validated' : 'pending' },
                      }),
                  },
                  {
                    label:
                      r.moderation === 'rejected' ? 'Publier' : 'Rejeter (retirer de la carte)',
                    icon: <Ban size={16} aria-hidden="true" />,
                    onSelect: () =>
                      update.mutate({
                        id: r.id,
                        patch: {
                          moderation: r.moderation === 'rejected' ? 'validated' : 'rejected',
                        },
                      }),
                  },
                  {
                    label: "Renvoyer à l'IA",
                    icon: <Sparkles size={16} aria-hidden="true" />,
                    disabled: !r.source_url,
                    hint: r.source_url
                      ? "L'IA relit l'article et refait le rattachement"
                      : 'Signalement sur place sans lien : rien à relire',
                    onSelect: () => backToAi.mutate(r.id),
                  },
                  {
                    label: 'Supprimer définitivement',
                    icon: <Trash2 size={16} aria-hidden="true" />,
                    danger: true,
                    onSelect: () => {
                      if (
                        window.confirm(
                          `Supprimer définitivement ce signal (${r.schools?.name ?? r.school_uai}) ?`,
                        )
                      ) {
                        remove.mutate(r)
                      }
                    },
                  },
                ]}
              />
            </div>
            {editing === r.id && (
              <EditForm
                report={r}
                busy={update.isPending}
                onCancel={() => setEditing(null)}
                onSave={(patch) => update.mutate({ id: r.id, patch })}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EditForm({
  report,
  busy,
  onSave,
  onCancel,
}: {
  report: AdminReport
  busy: boolean
  onSave: (patch: ReportPatch) => void
  onCancel: () => void
}) {
  const [status, setStatus] = useState<ReportStatus>(report.status)
  const [observed, setObserved] = useState(toLocalInput(report.observed_at))
  const [moderation, setModeration] = useState<Moderation>(report.moderation)
  const [school, setSchool] = useState<{ uai: string; label: string } | null>(null)
  const [changingSchool, setChangingSchool] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const patch: ReportPatch = {}
    if (status !== report.status) patch.status = status
    if (moderation !== report.moderation) patch.moderation = moderation
    if (school) patch.school_uai = school.uai
    const observedIso = new Date(observed).toISOString()
    if (observed !== toLocalInput(report.observed_at)) patch.observed_at = observedIso
    if (Object.keys(patch).length === 0) return onCancel()
    onSave(patch)
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-lg border border-border bg-bg p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field">
          Statut
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as ReportStatus)}
          >
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Heure du fait
          <input
            type="datetime-local"
            className="input"
            value={observed}
            max={toLocalInput(new Date().toISOString())}
            onChange={(e) => setObserved(e.target.value)}
            required
          />
        </label>
        <label className="field">
          État
          <select
            className="input"
            value={moderation}
            onChange={(e) => setModeration(e.target.value as Moderation)}
          >
            {(Object.keys(MODERATION_LABELS) as Moderation[]).map((m) => (
              <option key={m} value={m}>
                {MODERATION_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="text-sm">
        Établissement :{' '}
        <strong>
          {school?.label ??
            `${report.schools?.name ?? report.school_uai} (${report.schools?.city ?? ''})`}
        </strong>{' '}
        <button type="button" className="underline" onClick={() => setChangingSchool((v) => !v)}>
          {changingSchool ? 'Annuler' : "Changer d'établissement"}
        </button>
      </div>
      {changingSchool && (
        <SchoolSearch
          initial={report.schools?.city ?? ''}
          busy={busy}
          actionLabel="Choisir"
          onPick={(uai, label) => {
            setSchool({ uai, label })
            setChangingSchool(false)
          }}
        />
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          Enregistrer
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  )
}
