import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { figures, tierOf, type FigureRow, type Tier } from '@manifeste/core'
import { StatusBadge } from '@/components/status/StatusBadge'
import { fmtInt } from '@/lib/donneesFormat'
import { judgeReportsQuery, type JudgedReport } from '@/queries/admin'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

const TIER_LABEL: Record<Tier, string> = {
  confirmed: 'Confirmé',
  mobilisation: 'Mobilisation',
  not_retained: 'Non retenu',
  unjudged: 'Non jugé',
}
const TIER_HELP: Record<Tier, string> = {
  confirmed: 'Le texte dit bloqué ou fermé',
  mobilisation: 'Rassemblement, incident, cas incertain',
  not_retained: 'Récit, aperçu, mauvais établissement',
  unjudged: 'Article illisible ou trop court',
}
const TIER_DOT: Record<Tier, string> = {
  confirmed: 'bg-bloque',
  mobilisation: 'bg-filtrant',
  not_retained: 'bg-muted',
  unjudged: 'bg-border',
}
const TIERS: Tier[] = ['confirmed', 'mobilisation', 'not_retained', 'unjudged']
const NATURES = ['blockade', 'closed', 'gathering', 'incident', 'other'] as const
const NATURE_LABEL: Record<string, string> = {
  blockade: 'blocage',
  closed: 'fermé',
  gathering: 'rassemblement',
  incident: 'incident',
  other: 'autre',
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Row extends JudgedReport {
  tier: Tier
}

/**
 * Judge (Jev) observation mode: what it proposes for each published report. Nothing is
 * hidden or recounted: this page is for judging whether its opinions are good before relying on them.
 */
export function JudgePanel() {
  const query = useQuery(judgeReportsQuery)
  const [keep, setKeep] = useState(0.5)
  const [low, setLow] = useState(0.3)
  const [tier, setTier] = useState<Tier | 'all'>('all')
  const [nature, setNature] = useState<string>('all')
  const [disagree, setDisagree] = useState(false)
  const [sort, setSort] = useState<'score' | 'recent'>('score')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(60)

  const rows: Row[] = useMemo(
    () =>
      (query.data ?? []).map((r) => ({
        ...r,
        tier: tierOf(
          {
            probability: r.probability,
            nature: r.nature,
            status: r.status,
            onSite: r.origin === 'on_site',
            levelConflict: r.level != null && r.level !== 'unknown' && r.level !== r.schoolLevel,
          },
          { keep, low },
        ),
      })),
    [query.data, keep, low],
  )

  const counts = useMemo(() => {
    const c: Record<Tier, number> = { confirmed: 0, mobilisation: 0, not_retained: 0, unjudged: 0 }
    for (const r of rows) c[r.tier]++
    return c
  }, [rows])

  const columns = useMemo(() => {
    const rapport: FigureRow[] = rows.map((r) => ({
      uai: r.schoolUai,
      department: r.department,
      level: r.schoolLevel,
      status: r.status,
      observedAt: r.observedAt,
      domain: r.origin === 'on_site' ? null : r.sourceDomain,
      tier: r.tier,
      nature: r.nature,
    }))
    const now = new Date()
    const sets: Array<[string, Tier[]]> = [
      ['Aujourd’hui (sans juge)', TIERS],
      ['Confirmé seul', ['confirmed']],
      ['+ mobilisation', ['confirmed', 'mobilisation']],
      ['+ non jugés', ['confirmed', 'mobilisation', 'unjudged']],
    ]
    return sets.map(([name, t]) => ({ name, c: figures(rapport, t, now) }))
  }, [rows])

  const items = useMemo(() => {
    const text = normalize(q.trim())
    return rows
      .filter((r) => tier === 'all' || r.tier === tier)
      .filter((r) => nature === 'all' || r.nature === nature)
      .filter((r) => !disagree || (r.certainty === 'high' && r.tier !== 'confirmed'))
      .filter(
        (r) =>
          !text ||
          normalize(`${r.schoolName} ${r.schoolCity} ${r.sourceDomain ?? ''}`).includes(text),
      )
      .sort((a, b) =>
        sort === 'recent'
          ? b.observedAt.getTime() - a.observedAt.getTime()
          : (a.probability ?? 2) - (b.probability ?? 2),
      )
  }, [rows, tier, nature, disagree, sort, q])

  if (query.isPending) return <div className="h-40 animate-pulse rounded-lg bg-surface" />
  if (query.isError)
    return (
      <p className="text-bloque" role="alert">
        Impossible de charger : {query.error.message}. La migration <code>report_judge</code>{' '}
        est-elle appliquée ?
      </p>
    )

  const judged = rows.length - counts['unjudged']
  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted">
        Mode observation : le juge (Jev) donne son avis sur chaque signalement de presse lisible.
        Rien n'est masqué ni recompté sur le site. Les seuils ci-dessous ne changent que cet écran.
      </p>

      <section aria-label="Répartition" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTier(tier === t ? 'all' : t)}
            aria-pressed={tier === t}
            className="rounded-lg border border-border bg-surface p-3 text-left aria-pressed:border-accent"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className={`size-2.5 rounded-full ${TIER_DOT[t]}`} aria-hidden="true" />
              {TIER_LABEL[t]}
            </span>
            <span className="mt-1 block text-2xl font-bold tabular-nums">{fmtInt(counts[t])}</span>
            <span className="block text-xs text-muted">{TIER_HELP[t]}</span>
          </button>
        ))}
      </section>
      <p className="text-xs text-muted">
        {fmtInt(judged)} signalements jugés sur {fmtInt(rows.length)} publiés (
        {rows.length ? Math.round((100 * judged) / rows.length) : 0} %). Les anciens signalements
        sont jugés par la commande <code>npm run judge:backfill</code>.
      </p>

      <section aria-label="Seuils" className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Confirmé à partir de {Math.round(keep * 100)} %
          <input
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={keep}
            onChange={(e) => setKeep(Math.max(Number(e.target.value), low))}
            className="mt-1 block w-full"
          />
        </label>
        <label className="text-sm">
          Mobilisation à partir de {Math.round(low * 100)} %
          <input
            type="range"
            min={0.05}
            max={0.7}
            step={0.05}
            value={low}
            onChange={(e) => setLow(Math.min(Number(e.target.value), keep))}
            className="mt-1 block w-full"
          />
        </label>
      </section>

      <section aria-label="Chiffres" className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3 font-medium" />
              {columns.map((f) => (
                <th key={f.name} className="py-2 pr-3 font-medium">
                  {f.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <FigureTableRow label="Établissements" f={columns} get={(c) => fmtInt(c.schools)} />
            <FigureTableRow
              label="Meilleure journée"
              f={columns}
              get={(c) => `${fmtInt(c.peak.schools)} (${c.peak.day.slice(5)})`}
            />
            <FigureTableRow label="Départements" f={columns} get={(c) => fmtInt(c.departments)} />
            <FigureTableRow label="Facs" f={columns} get={(c) => fmtInt(c.higherEducation)} />
            <FigureTableRow
              label="En ce moment (dont bloqués)"
              f={columns}
              get={(c) => `${fmtInt(c.now.total)} (${fmtInt(c.now.blocked)})`}
            />
            <FigureTableRow label="Sources" f={columns} get={(c) => fmtInt(c.sources)} />
          </tbody>
        </table>
      </section>

      <section aria-label="Signalements" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Établissement, commune, site…"
            className="min-h-10 min-w-48 flex-1 rounded-lg border border-border bg-bg px-3"
            aria-label="Rechercher"
          />
          <select
            value={nature}
            onChange={(e) => setNature(e.target.value)}
            className="min-h-10 rounded-lg border border-border bg-bg px-2"
            aria-label="Nature"
          >
            <option value="all">Toutes natures</option>
            {NATURES.map((n) => (
              <option key={n} value={n}>
                {NATURE_LABEL[n]}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'score' | 'recent')}
            className="min-h-10 rounded-lg border border-border bg-bg px-2"
            aria-label="Tri"
          >
            <option value="score">Les plus douteux d'abord</option>
            <option value="recent">Les plus récents</option>
          </select>
          <label className="flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              checked={disagree}
              onChange={(e) => setDisagree(e.target.checked)}
            />
            Gemini « haute », juge non convaincu
          </label>
        </div>
        <p className="text-xs text-muted">{fmtInt(items.length)} signalements</p>
        <ul className="space-y-2">
          {items.slice(0, shown).map((r) => (
            <JudgeRow key={r.id} r={r} />
          ))}
        </ul>
        {items.length > shown && (
          <button type="button" className="btn-secondary" onClick={() => setShown(shown + 60)}>
            Afficher plus
          </button>
        )}
      </section>
    </div>
  )
}

function FigureTableRow({
  label,
  f,
  get,
}: {
  label: string
  f: Array<{ name: string; c: ReturnType<typeof figures> }>
  get: (c: ReturnType<typeof figures>) => string
}) {
  return (
    <tr className="border-b border-border">
      <th scope="row" className="py-2 pr-3 text-left font-normal text-muted">
        {label}
      </th>
      {f.map((x) => (
        <td key={x.name} className="py-2 pr-3 tabular-nums">
          {get(x.c)}
        </td>
      ))}
    </tr>
  )
}

function JudgeRow({ r }: { r: Row }) {
  const score = r.probability
  const levelClash = r.level && r.level !== 'unknown' && r.level !== r.schoolLevel
  return (
    <li className="rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {r.schoolName} <span className="font-normal text-muted">{r.schoolCity}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              Gemini : <StatusBadge status={r.status} />
              {r.certainty ? ` · ${r.certainty}` : ''}
            </span>
            <span>{dateFmt.format(r.observedAt)}</span>
            {r.sourceUrl ? (
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                {r.sourceDomain ?? 'source'} <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : (
              <span>{r.origin === 'on_site' ? 'sur place' : (r.sourceDomain ?? '')}</span>
            )}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-semibold">
          <span className={`size-2 rounded-full ${TIER_DOT[r.tier]}`} aria-hidden="true" />
          {TIER_LABEL[r.tier]}
        </span>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {score === null ? (
          <span className="text-muted">
            Pas d'avis du juge
            {r.judgedAt
              ? ' (article illisible ou trop court)'
              : ' (texte trop court, ou pas encore jugé)'}
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-24 overflow-hidden rounded-full bg-border"
                role="img"
                aria-label={`Probabilité ${Math.round(score * 100)} %`}
              >
                <span
                  className="block h-full bg-accent"
                  style={{ width: `${Math.round(score * 100)}%` }}
                />
              </span>
              <strong className="tabular-nums">{Math.round(score * 100)} %</strong>
            </span>
            <span>nature : {(r.nature && NATURE_LABEL[r.nature]) || '?'}</span>
            <span className={levelClash ? 'font-semibold text-filtrant' : ''}>
              niveau : {r.level ?? '?'}
              {levelClash ? ` (la base dit ${r.schoolLevel})` : ''}
            </span>
            <span className="text-muted">{r.model}</span>
          </>
        )}
      </p>
    </li>
  )
}
