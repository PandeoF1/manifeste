import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, FileSpreadsheet, Info, Quote } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { download, mediaCsv, renderMediaPng } from '@/lib/mediaExport'
import { queryKeys } from '@/lib/queryKeys'
import {
  aggregate,
  outletOf,
  topDemands,
  type Badge,
  type MediaRow,
  type OutletStats,
} from '@/lib/mediaStats'

const PERIODS = [
  { id: 7, label: '7 j' },
  { id: 30, label: '30 j' },
  { id: 0, label: 'Tout' },
] as const

const mediaQuery = (days: number) => ({
  queryKey: [...queryKeys.admin.all, 'media', days],
  queryFn: async (): Promise<MediaRow[]> => {
    let q = supabase
      .from('media_analyses')
      .select(
        'url, domain, title, published_at, about_movement, mentions_demands, demands, voices, focus, incidents, police_violence, terms, tone, quote_demands, quote_framing',
      )
      .order('published_at', { ascending: false })
      .limit(3000)
    if (days > 0) q = q.gte('published_at', new Date(Date.now() - days * 86_400_000).toISOString())
    const { data, error } = await q
    if (error) throw error
    return data
  },
})

const pct = (x: number) => `${Math.round(x * 100)} %`
const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
})

const FOCUS_LABEL: Record<MediaRow['focus'], string> = {
  revendications: 'Revendications',
  mobilisation: 'Mobilisation',
  incidents: 'Incidents',
  mixte: 'Mixte',
}
const TONE_LABEL: Record<MediaRow['tone'], string> = {
  favorable: 'favorable',
  neutre: 'neutre',
  defavorable: 'défavorable',
}
const TONE_CLASS: Record<MediaRow['tone'], string> = {
  favorable: 'text-good',
  neutre: 'text-muted',
  defavorable: 'text-poor',
}

/** Traitement médiatique de la mobilisation : chiffres par média ou propriétaire, articles. */
export function MediaPanel() {
  const [days, setDays] = useState<number>(30)
  const [by, setBy] = useState<'outlet' | 'owner'>('outlet')
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery(mediaQuery(days))
  const rows = useMemo(() => q.data ?? [], [q.data])
  const stats = useMemo(() => aggregate(rows, by), [rows, by])
  const relevant = rows.filter((r) => r.about_movement)
  const all = useMemo(() => aggregate(relevant, 'owner'), [relevant])
  const global = all.reduce(
    (acc, s) => {
      acc.n += s.articles
      acc.demands += s.demands * s.articles
      acc.students += s.studentVoices * s.articles
      acc.incidents += s.incidentsFocus * s.articles
      acc.police += s.policeViolence * s.articles
      return acc
    },
    { n: 0, demands: 0, students: 0, incidents: 0, police: 0 },
  )
  const demands = topDemands(rows)
  const [exporting, setExporting] = useState(false)
  const periodLabel = days === 0 ? 'depuis le début' : `${days} derniers jours`
  const stamp = new Date().toISOString().slice(0, 10)
  async function exportPng() {
    setExporting(true)
    try {
      download(
        await renderMediaPng(stats, { period: periodLabel, by, generatedAt: new Date() }),
        `manifeste-medias-${stamp}.png`,
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mt-4 space-y-6">
      <p className="flex gap-2 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        Chaque article de presse collecté est lu par l'IA, qui répond à des questions factuelles
        (revendications citées ? qui a la parole ? angle ?) avec un extrait à l'appui ; les extraits
        absents du texte sont écartés. Les constats sont calculés par des règles affichées au
        survol, pas par l'IA. Visible uniquement ici.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Période"
          value={days}
          options={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
          onChange={setDays}
        />
        <Segmented
          label="Regrouper par"
          value={by}
          options={[
            { value: 'outlet', label: 'Média' },
            { value: 'owner', label: 'Propriétaire' },
          ]}
          onChange={setBy}
        />
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="btn-secondary min-h-9 px-3 text-sm"
            disabled={stats.length === 0 || exporting}
            onClick={() => void exportPng()}
          >
            <Download size={16} aria-hidden="true" /> {exporting ? 'Export…' : 'Image (PNG)'}
          </button>
          <button
            type="button"
            className="btn-secondary min-h-9 px-3 text-sm"
            disabled={stats.length === 0}
            onClick={() =>
              download(
                new Blob([mediaCsv(stats, by)], { type: 'text/csv;charset=utf-8' }),
                `manifeste-medias-${stamp}.csv`,
              )
            }
          >
            <FileSpreadsheet size={16} aria-hidden="true" /> CSV
          </button>
        </div>
      </div>

      {q.isPending && <div className="h-64 animate-pulse rounded-xl bg-surface" />}
      {q.isError && (
        <p className="text-sm text-poor" role="alert">
          Impossible de charger les analyses : {q.error.message}
        </p>
      )}

      {q.data && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Vue d'ensemble">
            <Kpi label="Articles analysés" value={String(global.n)} />
            <Kpi
              label="Citent les revendications"
              value={global.n ? pct(global.demands / global.n) : '–'}
            />
            <Kpi
              label="Donnent la parole aux lycéens"
              value={global.n ? pct(global.students / global.n) : '–'}
            />
            <Kpi
              label="Angle « incidents »"
              value={global.n ? pct(global.incidents / global.n) : '–'}
            />
            <Kpi
              label="Évoquent des violences policières"
              value={global.n ? pct(global.police / global.n) : '–'}
            />
          </section>

          {demands.length > 0 && (
            <section className="card p-4">
              <h2 className="font-semibold">Revendications citées par la presse</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {demands.map(([d, n]) => (
                  <span key={d} className="rounded-full border border-border px-3 py-1 text-sm">
                    {d} <span className="text-muted tabular-nums">· {n}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="card overflow-x-auto p-0" aria-label="Par média">
            {stats.length === 0 && (
              <p className="p-4 text-sm text-muted">
                Pas encore d'article analysé sur la période. Les analyses arrivent avec les
                prochaines collectes.
              </p>
            )}
            {stats.length > 0 && (
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="p-3 font-medium">{by === 'owner' ? 'Propriétaire' : 'Média'}</th>
                    <th className="p-3 font-medium">Articles</th>
                    <Th title="Part des articles qui nomment les revendications">Revendications</Th>
                    <Th title="Part des articles où des lycéens s'expriment">Parole aux lycéens</Th>
                    <Th title="Part des articles où police, préfecture ou direction s'expriment">
                      Parole officielle
                    </Th>
                    <Th title="Part des articles dont l'angle principal est les incidents">
                      Angle incidents
                    </Th>
                    <Th title="Ton envers la mobilisation : favorable / défavorable">Ton + / −</Th>
                    <th className="p-3 font-medium">Constats</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <OutletRow
                      key={s.key}
                      s={s}
                      by={by}
                      open={open === s.key}
                      onToggle={() => setOpen(open === s.key ? null : s.key)}
                      articles={relevant.filter((r) =>
                        by === 'owner'
                          ? outletOf(r.domain).owner === s.key
                          : r.domain.replace(/^www\./, '') === s.key,
                      )}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function OutletRow({
  s,
  by,
  open,
  onToggle,
  articles,
}: {
  s: OutletStats
  by: 'outlet' | 'owner'
  open: boolean
  onToggle: () => void
  articles: MediaRow[]
}) {
  return (
    <>
      <tr className="border-b border-border align-top">
        <td className="p-3">
          <button
            type="button"
            className="text-left font-semibold hover:underline"
            aria-expanded={open}
            onClick={onToggle}
          >
            {s.name}
          </button>
          {by === 'outlet' && <div className="text-xs text-muted">{s.owner}</div>}
        </td>
        <td className="p-3 tabular-nums">{s.articles}</td>
        <Bar value={s.demands} good />
        <Bar value={s.studentVoices} good />
        <Bar value={s.officialVoices} />
        <Bar value={s.incidentsFocus} />
        <td className="p-3 whitespace-nowrap tabular-nums">
          <span className="text-good">{pct(s.favorable)}</span>
          {' / '}
          <span className="text-poor">{pct(s.defavorable)}</span>
        </td>
        <td className="p-3">
          <div className="flex flex-wrap gap-1">
            {s.badges.map((b) => (
              <BadgeChip key={b.id} b={b} />
            ))}
            {s.articles < 3 && <span className="text-xs text-muted">trop peu d'articles</span>}
          </div>
          {s.terms.length > 0 && (
            <div className="mt-1 text-xs text-muted">
              mots :{' '}
              {s.terms
                .slice(0, 4)
                .map(([t, n]) => `${t} (${n})`)
                .join(', ')}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-bg/60">
          <td colSpan={8} className="p-3">
            <ul className="space-y-3">
              {articles.slice(0, 30).map((a) => (
                <li key={a.url} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium hover:underline"
                    >
                      {a.title || a.url} <ExternalLink size={12} aria-hidden="true" />
                    </a>
                    <span className="text-xs text-muted">
                      {outletOf(a.domain).name}
                      {a.published_at ? ` · ${dateFmt.format(new Date(a.published_at))}` : ''}
                      {' · '}
                      {FOCUS_LABEL[a.focus]} ·{' '}
                      <span className={TONE_CLASS[a.tone]}>{TONE_LABEL[a.tone]}</span>
                      {a.mentions_demands ? ' · revendications' : ' · sans revendications'}
                    </span>
                  </div>
                  {[a.quote_framing, a.quote_demands].filter(Boolean).map((qt) => (
                    <p key={qt} className="mt-1 flex gap-1.5 text-xs text-muted italic">
                      <Quote size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                      {qt}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}

function Th({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <th className="p-3 font-medium" title={title}>
      {children}
    </th>
  )
}

/** Part en % avec une petite barre (vert si « plus c'est haut, mieux c'est »). */
function Bar({ value, good = false }: { value: number; good?: boolean }) {
  return (
    <td className="p-3">
      <div className="tabular-nums">{pct(value)}</div>
      <div className="mt-1 h-1.5 w-20 rounded-full bg-border/60">
        <div
          className={`h-1.5 rounded-full ${good ? 'bg-good' : 'bg-warn'}`}
          style={{ width: `${Math.max(value * 100, 2)}%` }}
        />
      </div>
    </td>
  )
}

const BADGE_CLASS: Record<Badge['tone'], string> = {
  good: 'border-good text-good',
  warn: 'border-warn text-warn',
  poor: 'border-poor text-poor',
}

function BadgeChip({ b }: { b: Badge }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE_CLASS[b.tone]}`}
      title={b.rule}
    >
      {b.label}
    </span>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-3xl font-black tabular-nums">{value}</div>
    </div>
  )
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-lg border border-border bg-surface p-0.5 text-sm"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="min-h-9 rounded-md px-3 aria-pressed:bg-bg aria-pressed:font-semibold"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
