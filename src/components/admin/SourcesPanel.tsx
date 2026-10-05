import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, ScrollText, Trash2 } from 'lucide-react'
import { formatRelative } from '@shared/status.ts'
import {
  SCRAPE_KINDS,
  SCRAPE_KIND_LABELS,
  SOURCE_PRESETS,
  SOURCE_TYPES_FOR_SCRAPE,
  newSourceSchema,
  type NewSource,
  type SourcePreset,
} from '@shared/sources.ts'
import { supabase } from '@/lib/supabase'
import { SourceLog } from './SourceLog'
import { queryKeys } from '@/lib/queryKeys'
import { runCollect, sourcesQuery, type CollectRunResult, type ScrapeSource } from '@/queries/admin'

const PLACEHOLDER: Record<NewSource['kind'], string> = {
  telegram: 'nom_du_canal ou https://t.me/nom_du_canal',
  rss: 'https://exemple.fr/feed.xml',
  bluesky: 'compte.bsky.social',
  mymaps: 'https://www.google.com/maps/d/viewer?mid=…',
}

export function SourcesPanel() {
  const queryClient = useQueryClient()
  const sources = useQuery(sourcesQuery)
  const [kind, setKind] = useState<NewSource['kind']>('telegram')
  const [formError, setFormError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<CollectRunResult | null>(null)
  const [logOpen, setLogOpen] = useState<string | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })

  const add = useMutation({
    mutationFn: async (input: NewSource) => {
      const { error } = await supabase.from('scrape_sources').insert(input)
      if (error)
        throw new Error(error.code === '23505' ? 'Cette source existe déjà.' : error.message)
    },
    onSuccess: invalidate,
  })
  const addMany = useMutation({
    mutationFn: async (presets: ReadonlyArray<SourcePreset>) => {
      const rows = presets.map(({ group: _group, ...row }) => row)
      const { error } = await supabase
        .from('scrape_sources')
        .upsert(rows, { onConflict: 'kind,identifier', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ScrapeSource> }) => {
      const { error } = await supabase.from('scrape_sources').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('scrape_sources').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })
  const run = useMutation({
    mutationFn: runCollect,
    onSuccess: (data) => {
      setLastRun(data)
      void invalidate()
      void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const parsed = newSourceSchema.safeParse({
      kind: data.get('kind'),
      identifier: data.get('identifier'),
      label: data.get('label'),
      source_type: data.get('source_type'),
      trusted: data.get('trusted') === 'on',
    })
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Formulaire invalide.')
      return
    }
    setFormError(null)
    add.mutate(parsed.data, { onSuccess: () => form.reset() })
  }

  const existing = new Set(sources.data?.map((s) => `${s.kind}:${s.identifier}`))

  return (
    <div className="space-y-6">
      <section aria-labelledby="add-source" className="card">
        <h2 id="add-source" className="text-base font-semibold">
          Ajouter une source
        </h2>
        <form onSubmit={onSubmit} className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="field">
            Type
            <select
              name="kind"
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as NewSource['kind'])}
            >
              {SCRAPE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SCRAPE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Identifiant
            <input name="identifier" required className="input" placeholder={PLACEHOLDER[kind]} />
          </label>
          <label className="field">
            Libellé
            <input
              name="label"
              required
              maxLength={120}
              className="input"
              placeholder="Nom affiché dans l'admin"
            />
          </label>
          <label className="field">
            Nature
            <select name="source_type" className="input" defaultValue="collecteur">
              {SOURCE_TYPES_FOR_SCRAPE.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-2 text-sm md:col-span-2">
            <input name="trusted" type="checkbox" className="size-5" />
            Source de confiance : ses signaux sont publiés sans modération
          </label>
          {(formError || add.error) && (
            <p role="alert" className="text-sm text-bloque md:col-span-2">
              {formError ?? add.error?.message}
            </p>
          )}
          <button type="submit" disabled={add.isPending} className="btn-primary md:col-span-2">
            Ajouter
          </button>
        </form>
        <Presets
          existing={existing}
          onAdd={(presets) => addMany.mutate(presets)}
          busy={addMany.isPending}
        />
        {addMany.error && (
          <p role="alert" className="mt-2 text-sm text-bloque">
            {addMany.error.message}
          </p>
        )}
      </section>

      <section aria-labelledby="sources-list">
        <div className="flex items-center justify-between gap-3">
          <h2 id="sources-list" className="text-base font-semibold">
            Sources surveillées ({sources.data?.length ?? 0})
          </h2>
          <button
            type="button"
            className="btn-primary"
            disabled={run.isPending}
            onClick={() => run.mutate(undefined)}
          >
            <Play size={16} /> {run.isPending ? 'Collecte en cours…' : 'Lancer la collecte'}
          </button>
        </div>
        {run.error && (
          <p role="alert" className="mt-2 text-sm text-bloque">
            Échec de la collecte : {run.error.message}
          </p>
        )}
        {lastRun && <RunSummary run={lastRun} />}

        {sources.isPending && <div className="mt-3 h-24 animate-pulse rounded-lg bg-surface" />}
        {sources.data?.length === 0 && (
          <p className="mt-3 text-sm text-muted">
            Aucune source. Ajoutez-en une ou utilisez un préréglage.
          </p>
        )}
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
          {sources.data?.map((s) => (
            <li key={s.id} className="p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.label}</div>
                  <div className="truncate text-sm text-muted">
                    {SCRAPE_KIND_LABELS[s.kind]} · {s.identifier}
                  </div>
                  <div className="text-xs text-muted">
                    {s.last_run_at
                      ? `dernier passage ${formatRelative(new Date(s.last_run_at))}`
                      : 'jamais collectée'}
                    {s.last_error && (
                      <span className="text-bloque"> · erreur : {s.last_error}</span>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={s.enabled}
                    onChange={(e) =>
                      update.mutate({ id: s.id, patch: { enabled: e.target.checked } })
                    }
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={s.trusted}
                    onChange={(e) =>
                      update.mutate({ id: s.id, patch: { trusted: e.target.checked } })
                    }
                  />
                  Confiance
                </label>
                <button
                  type="button"
                  className="btn-secondary min-h-10 px-3"
                  aria-expanded={logOpen === s.id}
                  onClick={() => setLogOpen(logOpen === s.id ? null : s.id)}
                >
                  <ScrollText size={16} aria-hidden="true" /> Journal
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Collecter ${s.label} maintenant`}
                  disabled={run.isPending}
                  onClick={() => run.mutate(s.id)}
                >
                  <Play size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Supprimer ${s.label}`}
                  onClick={() => {
                    if (window.confirm(`Supprimer la source « ${s.label} » ?`)) remove.mutate(s.id)
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              {logOpen === s.id && <SourceLog sourceId={s.id} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function RunSummary({ run }: { run: CollectRunResult }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface p-3 text-sm">
      <p className="text-muted">
        Modèle {run.model} · {run.gemini_calls ?? '?'} appel{(run.gemini_calls ?? 0) > 1 ? 's' : ''}{' '}
        Gemini · {(run.duration_ms / 1000).toFixed(1)} s
      </p>
      <table className="mt-2 w-full text-left tabular-nums">
        <thead className="text-muted">
          <tr>
            <th className="pr-3 font-normal">Source</th>
            <th className="pr-3 font-normal">Nouveaux</th>
            <th className="pr-3 font-normal">Pertinents</th>
            <th className="pr-3 font-normal">Faits IA</th>
            <th className="pr-3 font-normal">Signaux</th>
            <th className="pr-3 font-normal">Non rattachés</th>
            <th className="font-normal">Erreur</th>
          </tr>
        </thead>
        <tbody>
          {run.results.map((r) => (
            <tr key={r.source_id}>
              <td className="pr-3">{r.label}</td>
              <td className="pr-3">{r.new_items}</td>
              <td className="pr-3">{r.relevant}</td>
              <td className="pr-3">{r.events}</td>
              <td className="pr-3">{r.reports}</td>
              <td className="pr-3">{r.unmatched}</td>
              <td className="text-bloque">{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Sources recommandées, ajoutables en un clic (une par une ou toutes). */
function Presets({
  existing,
  onAdd,
  busy,
}: {
  existing: Set<string>
  onAdd: (presets: ReadonlyArray<SourcePreset>) => void
  busy: boolean
}) {
  const missing = SOURCE_PRESETS.filter((p) => !existing.has(`${p.kind}:${p.identifier}`))
  if (missing.length === 0) return null
  const groups = [...new Set(missing.map((p) => p.group))]
  return (
    <div className="mt-5 space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Sources recommandées</h3>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => onAdd(missing)}
        >
          Ajouter les {missing.length} sources
        </button>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <p className="text-xs font-semibold tracking-wider text-muted uppercase">{g}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {missing
              .filter((p) => p.group === g)
              .map((p) => (
                <button
                  key={p.identifier}
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => onAdd([p])}
                  title={p.trusted ? 'Ajoutée comme source de confiance' : undefined}
                >
                  + {p.label}
                  {p.trusted ? ' ✓' : ''}
                </button>
              ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted">
        ✓ = source de confiance (signaux publiés sans modération).
      </p>
    </div>
  )
}
