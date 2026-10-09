import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { chiffres, tierOf, type RapportRow, type Tier } from '@shared/judge-tiers.ts'
import { StatusBadge } from '@/components/status/StatusBadge'
import { fmtInt } from '@/lib/donneesFormat'
import { judgedReportsQuery, type JudgedReport } from '@/queries/judge'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

const TIER_LABEL: Record<Tier, string> = {
  confirme: 'Confirmé',
  mobilise: 'Mobilisation',
  'non-retenu': 'Non retenu',
  'non-juge': 'Non jugé',
}
const TIER_HELP: Record<Tier, string> = {
  confirme: 'Le texte dit bloqué ou fermé',
  mobilise: 'Rassemblement, incident, cas incertain',
  'non-retenu': 'Récit, aperçu, mauvais établissement',
  'non-juge': 'Article illisible ou trop court',
}
const TIER_DOT: Record<Tier, string> = {
  confirme: 'bg-bloque',
  mobilise: 'bg-filtrant',
  'non-retenu': 'bg-muted',
  'non-juge': 'bg-border',
}
const TIERS: Tier[] = ['confirme', 'mobilise', 'non-retenu', 'non-juge']
const NATURES = ['blocage', 'ferme', 'rassemblement', 'incident', 'autre'] as const

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Row extends JudgedReport {
  tier: Tier
}

/**
 * Mode observation du juge (Jev) : ce qu'il propose pour chaque signalement publié. Rien n'est
 * masqué ni recompté : cette page sert à juger si ses avis sont bons avant de s'en servir.
 */
export function JudgePanel() {
  const query = useQuery(judgedReportsQuery)
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
            probability: r.judge_score,
            nature: r.judge_nature,
            status: r.status,
            userReport: r.source_type === 'utilisateur',
          },
          keep,
          low,
        ),
      })),
    [query.data, keep, low],
  )

  const counts = useMemo(() => {
    const c: Record<Tier, number> = { confirme: 0, mobilise: 0, 'non-retenu': 0, 'non-juge': 0 }
    for (const r of rows) c[r.tier]++
    return c
  }, [rows])

  const figures = useMemo(() => {
    const rapport: RapportRow[] = rows.flatMap((r) =>
      r.schools
        ? [
            {
              uai: r.school_uai,
              department: r.schools.department,
              level: r.schools.level,
              status: r.status,
              observedAt: r.observed_at,
              domain: r.source_type === 'utilisateur' ? null : r.source_domain,
              tier: r.tier,
              nature: r.judge_nature,
            },
          ]
        : [],
    )
    const now = new Date()
    const sets: Array<[string, Tier[]]> = [
      ['Aujourd’hui (sans juge)', TIERS],
      ['Confirmé seul', ['confirme']],
      ['+ mobilisation', ['confirme', 'mobilise']],
      ['+ non jugés', ['confirme', 'mobilise', 'non-juge']],
    ]
    return sets.map(([name, t]) => ({ name, c: chiffres(rapport, t, now) }))
  }, [rows])

  const items = useMemo(() => {
    const text = normalize(q.trim())
    return rows
      .filter((r) => tier === 'all' || r.tier === tier)
      .filter((r) => nature === 'all' || r.judge_nature === nature)
      .filter((r) => !disagree || (r.certainty === 'haute' && r.tier !== 'confirme'))
      .filter(
        (r) =>
          !text ||
          normalize(
            `${r.schools?.name ?? ''} ${r.schools?.city ?? ''} ${r.source_domain ?? ''}`,
          ).includes(text),
      )
      .sort((a, b) =>
        sort === 'recent'
          ? b.observed_at.localeCompare(a.observed_at)
          : (a.judge_score ?? 2) - (b.judge_score ?? 2),
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

  const judged = rows.length - counts['non-juge']
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
              {figures.map((f) => (
                <th key={f.name} className="py-2 pr-3 font-medium">
                  {f.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <FigureRow label="Établissements" f={figures} get={(c) => fmtInt(c.etablissements)} />
            <FigureRow
              label="Meilleure journée"
              f={figures}
              get={(c) => `${fmtInt(c.pic.n)} (${c.pic.jour.slice(5)})`}
            />
            <FigureRow label="Départements" f={figures} get={(c) => fmtInt(c.departements)} />
            <FigureRow label="Facs" f={figures} get={(c) => fmtInt(c.facs)} />
            <FigureRow
              label="En ce moment (dont bloqués)"
              f={figures}
              get={(c) => `${fmtInt(c.maintenant.total)} (${fmtInt(c.maintenant.bloques)})`}
            />
            <FigureRow label="Sources" f={figures} get={(c) => fmtInt(c.sources)} />
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
                {n}
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

function FigureRow({
  label,
  f,
  get,
}: {
  label: string
  f: Array<{ name: string; c: ReturnType<typeof chiffres> }>
  get: (c: ReturnType<typeof chiffres>) => string
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
  const score = r.judge_score
  const levelClash =
    r.judge_level && r.judge_level !== 'inconnu' && r.schools && r.judge_level !== r.schools.level
  return (
    <li className="rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {r.schools?.name ?? '?'}{' '}
            <span className="font-normal text-muted">{r.schools?.city}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              Gemini : <StatusBadge status={r.status} />
              {r.certainty ? ` · ${r.certainty}` : ''}
            </span>
            <span>{dateFmt.format(new Date(r.observed_at))}</span>
            {r.source_url ? (
              <a
                href={r.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                {r.source_domain ?? 'source'} <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : (
              <span>{r.source_type === 'utilisateur' ? 'sur place' : (r.source_domain ?? '')}</span>
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
            {r.judged_at ? ' (article illisible ou trop court)' : ' (pas encore jugé)'}
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
            <span>nature : {r.judge_nature ?? '?'}</span>
            <span className={levelClash ? 'font-semibold text-filtrant' : ''}>
              niveau : {r.judge_level ?? '?'}
              {levelClash ? ` (la base dit ${r.schools?.level})` : ''}
            </span>
            <span className="text-muted">{r.judge_model}</span>
          </>
        )}
      </p>
    </li>
  )
}
