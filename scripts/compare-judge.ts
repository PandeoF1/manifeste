/**
 * Compare, par groupes de données, ce que Gemini a publié et ce que le juge Jev en garde.
 *
 * On part des signalements déjà en base (la sortie de l'étape 1, Gemini, après nos règles), on
 * relit l'article de chacun, et on demande à Jev : est-ce vrai, de quelle nature, lycée ou fac ?
 * Rien n'est modifié en base. On obtient, par groupe : combien Jev garde, met en doute ou retire.
 *
 *   npm run compare:judge                          # simulation : volumes et coût estimé (gratuit)
 *   npm run compare:judge -- --run --limit 10      # essai sur 10 signalements
 *   npm run compare:judge -- --run --hours 24 --group domain
 *   npm run compare:judge -- --run --hours 48 --group day --labels audit-manuel.csv
 *
 * Options : --hours N (défaut 24, fenêtre sur la date de création) ou --all (toute la base), --group domain|day|status|level|
 * certainty (défaut domain), --keep 0.5 et --low 0.3 (seuils), --limit N, --model (défaut jev-1.13.0,
 * version fixée : « jev-latest » peut changer sans prévenir), --labels fichier.csv (audit manuel :
 * mesure alors précision et rappel sur les signalements déjà jugés), --sample N (écrit
 * compare-judge-sample.csv : N signalements à relire à la main, tirés dans chaque zone, au format de
 * l'audit manuel ; une fois la colonne « blocage » remplie, relancer avec --labels dessus),
 * --out compare-judge-review.csv.
 * Variables : TYPESAFE_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (.env.backfill, .env.prod,
 * .env). Les articles et les réponses sont gardés dans .compare-judge-cache.json : relancer ne
 * rappelle rien. Les liens Google Actualités et les sites qui bloquent la lecture sont comptés à part.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parseArticle } from './audit-reports-lib.ts'
import { parseLabels } from './eval-prompt-lib.ts'
import {
  JEV_USD_PER_INPUT_TOKEN,
  buildQuestions,
  chiffres,
  conflictsWithBase,
  estimateTokens,
  focusState,
  parseJevResponse,
  summarizeGroups,
  tierOf,
  zoneOf,
  type RapportRow,
  type Tier,
  type GroupBy,
  type JudgeAnswer,
  type ReportRow,
} from './eval-judge-lib.ts'

for (const f of ['.env.backfill', '.env.prod', '.env']) if (existsSync(f)) process.loadEnvFile(f)

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const RUN = process.argv.includes('--run')
const HOURS = Number(arg('hours') ?? 24)
const ALL = process.argv.includes('--all')
const GROUP = (arg('group') ?? 'domain') as GroupBy
const KEEP = Number(arg('keep') ?? 0.5)
const LOW = Number(arg('low') ?? 0.3)
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const MODEL = arg('model') ?? 'jev-1.13.0'
const LABELS = arg('labels')
const OUT = arg('out') ?? 'compare-judge-review.csv'
const SAMPLE = arg('sample') ? Number(arg('sample')) : 0
const SAMPLE_OUT = 'compare-judge-sample.csv'
const CACHE_FILE = '.compare-judge-cache.json'
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} est requis (environnement ou .env.backfill / .env.prod / .env).`)
  return v
}

interface Article {
  status: number
  title?: string
  text?: string
}
interface Cache {
  articles: Record<string, Article>
  judged: Record<string, JudgeAnswer>
}
const cache: Cache = existsSync(CACHE_FILE)
  ? (JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache)
  : { articles: {}, judged: {} }
const save = () => writeFileSync(CACHE_FILE, JSON.stringify(cache))

interface Row {
  id: string
  url: string
  domain: string
  status: string
  certainty: string | null
  createdAt: string
  observedAt: string
  uai: string
  sourceType: string
  school: { name: string; city: string; level: string; department: string }
}

const parisDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso))

async function loadRows(): Promise<{ all: Row[]; rows: Row[]; unreadable: number }> {
  const supabase = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'))
  const since = ALL
    ? '2000-01-01T00:00:00Z'
    : new Date(Date.now() - HOURS * 3_600_000).toISOString()
  const all: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('reports')
      .select(
        'id, school_uai, status, certainty, source_type, source_url, source_domain, observed_at, created_at, schools(name, city, level, department)',
      )
      .eq('moderation', 'validated')
      .eq('hidden', false)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`reports : ${error.message}`)
    for (const r of data as unknown as {
      id: string
      school_uai: string
      status: string
      certainty: string | null
      source_type: string
      source_url: string | null
      source_domain: string | null
      observed_at: string
      created_at: string
      schools: { name: string; city: string; level: string; department: string } | null
    }[])
      if (r.schools)
        all.push({
          id: r.id,
          uai: r.school_uai,
          sourceType: r.source_type,
          url: r.source_url ?? '',
          domain: r.source_domain ?? '?',
          status: r.status,
          certainty: r.certainty,
          createdAt: r.created_at,
          observedAt: r.observed_at,
          school: r.schools,
        })
    if (data.length < 1000) break
  }
  const readable = all.filter((r) => r.url !== '' && !r.url.includes('news.google.com'))
  return { all, rows: readable.slice(0, LIMIT), unreadable: all.length - readable.length }
}

async function loadArticles(urls: string[]): Promise<void> {
  const todo = urls.filter((u) => !(u in cache.articles))
  console.log(`Articles : ${urls.length - todo.length} en cache, ${todo.length} à lire.`)
  let next = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < todo.length) {
        const u = todo[next++] as string
        try {
          const res = await fetch(u, {
            redirect: 'follow',
            signal: AbortSignal.timeout(20_000),
            headers: {
              'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
              'accept-language': 'fr-FR',
            },
          })
          cache.articles[u] = res.ok
            ? { status: res.status, ...parseArticle(await res.text()) }
            : { status: res.status }
        } catch {
          cache.articles[u] = { status: 0 }
        }
      }
    }),
  )
  save()
}

const stateOf = (r: Row) => {
  const a = cache.articles[r.url] as Article
  return focusState({ title: a.title ?? '', text: a.text ?? '' }, r.school, parisDay(r.observedAt))
}
const keyOf = (r: Row) =>
  createHash('sha1')
    .update(
      `${MODEL}|${JSON.stringify(buildQuestions(r.school, r.status as 'bloque' | 'filtrant' | 'leve'))}|${stateOf(r)}`,
    )
    .digest('hex')
    .slice(0, 20)

async function ask(r: Row, showRaw: boolean): Promise<JudgeAnswer> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env('TYPESAFE_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      state: stateOf(r),
      model: MODEL,
      questions: buildQuestions(r.school, r.status as 'bloque' | 'filtrant' | 'leve'),
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Jev HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`)
  const json: unknown = await res.json()
  if (showRaw) console.log('\nRéponse brute (premier appel) :', JSON.stringify(json).slice(0, 700))
  return parseJevResponse(json)
}

const csv = (v: unknown) =>
  `"${String(v ?? '')
    .replaceAll('"', '""')
    .replaceAll('\n', ' ')}"`
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : '—')

async function main() {
  const { all, rows: loaded, unreadable } = await loadRows()
  console.log(
    `${all.length} signalements validés créés ${ALL ? 'au total' : `depuis ${HOURS} h`} ; ${unreadable} sans article relisible (Google Actualités, signalements sur place).`depuis ${HOURS} h`} ; ${unreadable} en lien Google Actualités (non relisibles).`,
  )
  await loadArticles([...new Set(loaded.map((r) => r.url))])
  const rows = loaded.filter((r) => (cache.articles[r.url]?.text ?? '').length >= 300)
  console.log(`${rows.length} relus, ${loaded.length - rows.length} illisibles (403, page vide…).`)

  const todo = rows.filter((r) => !(keyOf(r) in cache.judged))
  const tokens = estimateTokens(todo.map((r) => stateOf(r)))
  console.log(
    `${todo.length} appel(s) Jev à faire (${MODEL}), ≈ ${tokens} tokens ≈ ${(tokens * JEV_USD_PER_INPUT_TOKEN).toFixed(4)} $. Aucun appel Gemini.`,
  )
  if (!RUN) {
    console.log('Simulation seulement. Relancer avec --run (et --limit 10 pour un premier essai).')
    return
  }
  let first = true
  let next = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < todo.length) {
        const r = todo[next++] as Row
        const showRaw = first
        first = false
        try {
          cache.judged[keyOf(r)] = await ask(r, showRaw)
        } catch (e) {
          save()
          console.error(`\n${r.id} : ${e instanceof Error ? e.message : String(e)}`)
          process.exit(1)
        }
        process.stdout.write(`\r  ${next}/${todo.length}`)
      }
    }),
  )
  save()
  console.log()

  const report: (ReportRow & { row: Row; answer: JudgeAnswer | undefined })[] = rows.map((r) => {
    const a = cache.judged[keyOf(r)]
    return {
      id: r.id,
      day: parisDay(r.observedAt),
      domain: r.domain,
      status: r.status,
      level: r.school.level,
      certainty: r.certainty,
      probability: a?.probability ?? null,
      nature: a?.nature ?? null,
      levelConflict: a ? conflictsWithBase(r.school.level, a) : false,
      row: r,
      answer: a,
    }
  })

  const groups = summarizeGroups(report, GROUP, KEEP, LOW)
  console.log(
    `\nPar ${GROUP} (garde ≥ ${KEEP} ; incertain ${LOW}–${KEEP} ; retire < ${LOW} ou niveau contredit) :`,
  )
  console.log('groupe'.padEnd(34), 'total  garde  incert.  retire')
  for (const g of groups.slice(0, 25))
    console.log(
      g.group.slice(0, 33).padEnd(34),
      String(g.n).padStart(5),
      String(g.garde).padStart(6),
      String(g.incertain).padStart(8),
      String(g.retire).padStart(7),
      `  ${Object.entries(g.natures)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`,
    )
  const total = report.length
  const count = (z: string) => report.filter((r) => zoneOf(r, KEEP, LOW) === z).length
  console.log(
    `\nTotal : ${total} signalements → garde ${count('garde')} (${pct(count('garde'), total)}), incertain ${count('incertain')}, retire ${count('retire')} (${pct(count('retire'), total)}), sans réponse ${count('non-juge')}.`,
  )
  const conflicts = report.filter((r) => r.levelConflict).length
  if (conflicts)
    console.log(`Dont ${conflicts} avec un niveau (lycée / fac) contredit par le juge.`)

  if (LABELS) {
    const labels = new Map(parseLabels(readFileSync(LABELS, 'utf8')).map((l) => [l.id, l.blocage]))
    const known = report.filter((r) => labels.has(r.id) && r.probability !== null)
    const kept = known.filter((r) => zoneOf(r, KEEP, LOW) === 'garde')
    const good = (rs: typeof known) => rs.filter((r) => labels.get(r.id) === 'oui').length
    console.log(
      `\nSur ${known.length} signalements déjà jugés à la main : ${pct(good(known), known.length)} vrais avant le juge, ${pct(good(kept), kept.length)} après (${kept.length} gardés, ${good(known) - good(kept)} vrais perdus).`,
    )
    console.log('Par zone (vrais / faux selon la relecture) :')
    for (const z of ['garde', 'incertain', 'retire'] as const) {
      const inZone = known.filter((r) => zoneOf(r, KEEP, LOW) === z)
      console.log(`  ${z.padEnd(9)} ${good(inZone)} vrais, ${inZone.length - good(inZone)} faux`)
    }
  }

  if (SAMPLE > 0) {
    const zones = ['retire', 'incertain', 'garde'] as const
    const pick: typeof report = []
    for (const z of zones) {
      const inZone = report
        .filter((r) => zoneOf(r, KEEP, LOW) === z)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
      const step = Math.max(1, Math.floor(inZone.length / Math.ceil(SAMPLE / 3)))
      pick.push(...inZone.filter((_, i) => i % step === 0).slice(0, Math.ceil(SAMPLE / 3)))
    }
    const head =
      'id,url_finale,blocage,type_erreur,citation,zone_jev,proba_jev,nature_jev,ecole,ville,statut_gemini'
    writeFileSync(
      SAMPLE_OUT,
      [
        head,
        ...pick.map((r) =>
          [
            r.id,
            r.row.url,
            '',
            '',
            '',
            zoneOf(r, KEEP, LOW),
            r.probability ?? '',
            r.nature ?? '',
            r.row.school.name,
            r.row.school.city,
            r.status,
          ]
            .map(csv)
            .join(','),
        ),
      ].join('\n'),
    )
    console.log(
      `\n${pick.length} signalements à relire (retirés, incertains et gardés mélangés) : ${SAMPLE_OUT}. Remplis « blocage » (oui/non), puis relance avec --labels ${SAMPLE_OUT}.`,
    )
  }

  const lines = [
    'id,zone,proba_jev,nature_jev,niveau_jev,niveau_base,statut,certitude_gemini,domaine,ecole,ville,url,extrait',
    ...report
      .sort((a, b) => (a.probability ?? 2) - (b.probability ?? 2))
      .map((r) =>
        [
          r.id,
          zoneOf(r, KEEP, LOW),
          r.probability ?? '',
          r.nature ?? '',
          r.answer?.level ?? '',
          r.level,
          r.status,
          r.certainty ?? '',
          r.domain,
          r.row.school.name,
          r.row.school.city,
          r.row.url,
          stateOf(r.row).split('\n').slice(3, 5).join(' / ').slice(0, 300),
        ]
          .map(csv)
          .join(','),
      ),
  ]
  writeFileSync(OUT, lines.join('\n'))
  console.log(`Détail à relire (les plus douteux d'abord) : ${OUT}`)

  // --- Rapport par niveaux : ce que montrerait le site avec le juge --------------------------------
  const verdict = new Map(report.map((r) => [r.id, r]))
  const tierRows: RapportRow[] = all.map((r) => {
    const v = verdict.get(r.id)
    const tier: Tier = tierOf(
      {
        probability: v?.probability ?? null,
        nature: v?.nature ?? null,
        levelConflict: v?.levelConflict ?? false,
        userReport: r.sourceType === 'utilisateur',
      },
      KEEP,
      LOW,
    )
    return {
      uai: r.uai,
      department: r.school.department,
      level: r.school.level,
      status: r.status,
      observedAt: r.observedAt,
      domain: r.sourceType === 'utilisateur' ? null : r.domain,
      tier,
      nature: v?.nature ?? null,
    }
  })
  const now = new Date()
  const nTier = (t: Tier) => tierRows.filter((r) => r.tier === t).length
  const cols: Array<[string, Tier[]]> = [
    ['Aujourd’hui (sans juge)', ['confirme', 'mobilise', 'non-retenu', 'non-juge']],
    ['Confirmé seul', ['confirme']],
    ['+ mobilisation', ['confirme', 'mobilise']],
    ['+ non jugés (tels quels)', ['confirme', 'mobilise', 'non-juge']],
  ]
  const fig = cols.map(([name, tiers]) => ({ name, c: chiffres(tierRows, tiers, now) }))
  const rapportLines: Array<[string, (c: ReturnType<typeof chiffres>) => string]> = [
    ['Établissements bloqués ou filtrants', (c) => String(c.etablissements)],
    ['En une seule journée (meilleure)', (c) => `${c.pic.n} (${c.pic.jour})`],
    ['Départements touchés', (c) => String(c.departements)],
    ['Facs et écoles supérieures', (c) => String(c.facs)],
    ['En ce moment (dont bloqués)', (c) => `${c.maintenant.total} (${c.maintenant.bloques})`],
    ['Sites de presse et sources', (c) => String(c.sources)],
    [
      'Nature (établissements)',
      (c) =>
        Object.entries(c.natures)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v}`)
          .join(', '),
    ],
  ]
  const md = [
    `# Rapport par niveaux (${new Date().toISOString().slice(0, 16)} UTC, ${MODEL}, seuils ${LOW} / ${KEEP})`,
    '',
    `Signalements validés : ${all.length} dont confirmés ${nTier('confirme')}, mobilisation ${nTier('mobilise')}, non retenus ${nTier('non-retenu')}, non jugés ${nTier('non-juge')}.`,
    '',
    `| | ${fig.map((f) => f.name).join(' | ')} |`,
    `|---|${fig.map(() => '---').join('|')}|`,
    ...rapportLines.map(([label, f]) => `| ${label} | ${fig.map((x) => f(x.c)).join(' | ')} |`),
  ].join('\n')
  console.log(`\n${md}`)
  writeFileSync('compare-judge-rapport.md', md)
  console.log('\nRapport écrit : compare-judge-rapport.md')
}

await main()
