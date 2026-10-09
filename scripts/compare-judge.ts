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
 * Options : --hours N (défaut 24, fenêtre sur la date de création), --group domain|day|status|level|
 * certainty (défaut domain), --keep 0.5 et --low 0.3 (seuils), --limit N, --model (défaut jev-1.13.0,
 * version fixée : « jev-latest » peut changer sans prévenir), --labels fichier.csv (audit manuel :
 * mesure alors précision et rappel sur les signalements déjà jugés), --out compare-judge-review.csv.
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
  conflictsWithBase,
  estimateTokens,
  focusState,
  parseJevResponse,
  summarizeGroups,
  zoneOf,
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
const GROUP = (arg('group') ?? 'domain') as GroupBy
const KEEP = Number(arg('keep') ?? 0.5)
const LOW = Number(arg('low') ?? 0.3)
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const MODEL = arg('model') ?? 'jev-1.13.0'
const LABELS = arg('labels')
const OUT = arg('out') ?? 'compare-judge-review.csv'
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
  school: { name: string; city: string; level: string }
}

const parisDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso))

async function loadRows(): Promise<{ rows: Row[]; unreadable: number }> {
  const supabase = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'))
  const since = new Date(Date.now() - HOURS * 3_600_000).toISOString()
  const all: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('reports')
      .select(
        'id, status, certainty, source_url, source_domain, observed_at, created_at, schools(name, city, level)',
      )
      .eq('moderation', 'validated')
      .eq('hidden', false)
      .not('source_url', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`reports : ${error.message}`)
    for (const r of data as unknown as {
      id: string
      status: string
      certainty: string | null
      source_url: string
      source_domain: string | null
      observed_at: string
      created_at: string
      schools: { name: string; city: string; level: string } | null
    }[])
      if (r.schools)
        all.push({
          id: r.id,
          url: r.source_url,
          domain: r.source_domain ?? '?',
          status: r.status,
          certainty: r.certainty,
          createdAt: r.created_at,
          observedAt: r.observed_at,
          school: r.schools,
        })
    if (data.length < 1000) break
  }
  const readable = all.filter((r) => !r.url.includes('news.google.com'))
  return { rows: readable.slice(0, LIMIT), unreadable: all.length - readable.length }
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
    .update(`${MODEL}|${JSON.stringify(buildQuestions(r.school))}|${stateOf(r)}`)
    .digest('hex')
    .slice(0, 20)

async function ask(r: Row, showRaw: boolean): Promise<JudgeAnswer> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env('TYPESAFE_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ state: stateOf(r), model: MODEL, questions: buildQuestions(r.school) }),
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
  const { rows: loaded, unreadable } = await loadRows()
  console.log(
    `${loaded.length + unreadable} signalements validés créés depuis ${HOURS} h ; ${unreadable} en lien Google Actualités (non relisibles).`,
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
}

await main()
