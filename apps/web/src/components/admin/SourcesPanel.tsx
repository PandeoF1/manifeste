import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, History, Play, RotateCcw, Trash2 } from 'lucide-react'
import { formatRelative } from '@/lib/labels'
import { queryKeys } from '@/lib/queryKeys'
import {
  addSource,
  deleteSource,
  patchSource,
  presetsQuery,
  resetSourceHealth,
  runSource,
  sourceRunsQuery,
  sourcesQuery,
  type NewSource,
  type Source,
} from '@/queries/admin'

type Kind = NewSource['kind']
const SOURCE_KINDS: readonly Kind[] = ['telegram', 'rss', 'bluesky', 'mymaps']
const KIND_LABELS: Record<Kind, string> = {
  telegram: 'Canal Telegram public',
  rss: 'Flux RSS / Atom',
  bluesky: 'Compte Bluesky',
  mymaps: 'Carte Google My Maps',
}
const PLACEHOLDER: Record<Kind, string> = {
  telegram: 'nom_du_canal ou https://t.me/nom_du_canal',
  rss: 'https://exemple.fr/feed.xml',
  bluesky: 'compte.bsky.social',
  mymaps: 'https://www.google.com/maps/d/viewer?mid=…',
}
const ORIGIN_LABELS = { press: 'Presse', union: 'Syndicat', aggregator: 'Collecteur' } as const
const HEALTH: Record<Source['health'], { label: string; className: string }> = {
  closed: { label: 'sain', className: 'border-leve text-fg' },
  half_open: { label: 'essai', className: 'border-filtrant text-filtrant' },
  open: { label: 'en pause', className: 'border-bloque text-bloque' },
}
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

export function SourcesPanel() {
  const queryClient = useQueryClient()
  const sources = useQuery(sourcesQuery)
  const presets = useQuery(presetsQuery)
  const [kind, setKind] = useState<Kind>('telegram')
  const [logOpen, setLogOpen] = useState<string | null>(null)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.sources() })

  const add = useMutation({ mutationFn: addSource, onSuccess: invalidate })
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof patchSource>[1]) =>
      patchSource(id, body),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: deleteSource, onSuccess: invalidate })
  const run = useMutation({ mutationFn: runSource, onSuccess: () => setTimeout(invalidate, 3000) })
  const reset = useMutation({ mutationFn: resetSourceHealth, onSuccess: invalidate })
  const error = add.error ?? patch.error ?? remove.error ?? run.error ?? reset.error

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    add.mutate(
      {
        kind,
        identifier: String(data.get('identifier') ?? ''),
        label: String(data.get('label') ?? ''),
        origin: String(data.get('origin')) as Source['origin'],
        trusted: data.get('trusted') === 'on',
      },
      { onSuccess: () => form.reset() },
    )
  }

  if (sources.isPending) return <div className="h-24 animate-pulse rounded-lg bg-surface" />
  if (sources.isError) return <p className="text-bloque">Erreur de chargement.</p>

  const groups = new Map<string, NonNullable<typeof presets.data>>()
  for (const p of presets.data ?? []) groups.set(p.group, [...(groups.get(p.group) ?? []), p])

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Ajouter une source</h2>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="field">
            Type
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Libellé
            <input name="label" className="input" required maxLength={120} />
          </label>
          <label className="field sm:col-span-2">
            Identifiant
            <input name="identifier" className="input" required placeholder={PLACEHOLDER[kind]} />
          </label>
          <label className="field">
            Origine
            <select name="origin" className="input" defaultValue="aggregator">
              {Object.entries(ORIGIN_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input name="trusted" type="checkbox" /> De confiance (publié sans modération)
          </label>
          <div className="sm:col-span-2">
            <button className="btn-primary" disabled={add.isPending}>
              Ajouter
            </button>
          </div>
        </form>
        {presets.data && presets.data.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm underline">
              Sources prêtes à l'emploi ({presets.data.length})
            </summary>
            <div className="mt-2 space-y-3">
              {[...groups].map(([group, list]) => (
                <div key={group}>
                  <h3 className="text-sm font-semibold">{group}</h3>
                  <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
                    {list.map((p) => (
                      <li
                        key={`${p.kind}|${p.identifier}`}
                        className="flex items-center gap-3 px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">{p.label}</span>
                        <button
                          type="button"
                          className="btn-secondary min-h-9 px-3 text-sm"
                          disabled={add.isPending}
                          onClick={() => add.mutate(p)}
                        >
                          Ajouter
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-bloque">
          Échec : {error.message}
        </p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {sources.data.map((s) => (
          <li key={s.id} className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.label}</span>
                  <span
                    className={`rounded-full border px-2 text-xs ${HEALTH[s.health].className}`}
                  >
                    {s.enabled ? HEALTH[s.health].label : 'désactivée'}
                  </span>
                  {s.trusted && (
                    <span className="rounded-full border border-border px-2 text-xs">
                      confiance
                    </span>
                  )}
                  {s.reportsHidden && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 text-xs">
                      <EyeOff size={12} aria-hidden="true" /> signalements masqués
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {KIND_LABELS[s.kind]} · {s.identifier}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                  <span>
                    {s.lastSuccessAt ? `lue ${formatRelative(s.lastSuccessAt)}` : 'jamais lue'}
                  </span>
                  <span className="tabular-nums">
                    24 h : {s.stats.items24h} éléments, {s.stats.relevant24h} pertinents
                  </span>
                  <span className="tabular-nums">7 j : {s.stats.reports7d} signalements</span>
                </div>
                {s.lastError && (
                  <p className="mt-1 text-xs text-bloque">
                    {s.consecutiveFailures} échec{s.consecutiveFailures > 1 ? 's' : ''} de suite :{' '}
                    {s.lastError}
                    {s.nextAttemptAt &&
                      s.health === 'open' &&
                      ` · prochaine tentative ${dateFmt.format(s.nextAttemptAt)}`}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Lire maintenant"
                title="Lire maintenant"
                onClick={() => run.mutate(s.id)}
              >
                <Play size={18} />
              </button>
              {s.health !== 'closed' && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Réarmer la source"
                  title="Réarmer (fermer le disjoncteur)"
                  onClick={() => reset.mutate(s.id)}
                >
                  <RotateCcw size={18} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label="Historique des lectures"
                aria-expanded={logOpen === s.id}
                onClick={() => setLogOpen(logOpen === s.id ? null : s.id)}
              >
                <History size={18} />
              </button>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => patch.mutate({ id: s.id, enabled: e.target.checked })}
                />{' '}
                active
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={s.trusted}
                  onChange={(e) => patch.mutate({ id: s.id, trusted: e.target.checked })}
                />{' '}
                confiance
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={s.reportsHidden}
                  onChange={(e) => patch.mutate({ id: s.id, reportsHidden: e.target.checked })}
                />{' '}
                masquer
              </label>
              <button
                type="button"
                className="icon-btn"
                aria-label="Supprimer la source"
                onClick={() => {
                  if (window.confirm(`Supprimer « ${s.label} » et tout ce qu'elle a collecté ?`))
                    remove.mutate(s.id)
                }}
              >
                <Trash2 size={18} />
              </button>
            </div>
            {logOpen === s.id && <Runs id={s.id} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Runs({ id }: { id: string }) {
  const runs = useQuery(sourceRunsQuery(id))
  if (runs.isPending) return <div className="mt-2 h-12 animate-pulse rounded bg-bg" />
  if (!runs.data?.length)
    return <p className="mt-2 text-sm text-muted">Aucune lecture enregistrée.</p>
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead className="text-muted">
        <tr>
          <th className="py-1 font-normal">Début</th>
          <th className="font-normal">Déclencheur</th>
          <th className="text-right font-normal">Lus</th>
          <th className="text-right font-normal">Nouveaux</th>
          <th className="pl-3 font-normal">Résultat</th>
        </tr>
      </thead>
      <tbody>
        {runs.data.map((r) => (
          <tr key={String(r.startedAt)} className="border-t border-border">
            <td className="py-1">{dateFmt.format(new Date(r.startedAt))}</td>
            <td>{r.trigger === 'manual' ? 'manuel' : 'planifié'}</td>
            <td className="text-right tabular-nums">{r.fetched}</td>
            <td className="text-right tabular-nums">{r.newItems}</td>
            <td className={`pl-3 ${r.error ? 'text-bloque' : ''}`}>{r.error ?? 'ok'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
