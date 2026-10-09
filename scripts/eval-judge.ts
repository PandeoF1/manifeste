/**
 * Banc d'essai du juge Jev (TypeSafe AI) sur les signalements jugés à la main.
 *
 * Pour chaque signalement de audit-manuel.csv, on envoie à Jev le texte de l'article (déjà en cache
 * grâce à `npm run eval:prompt`) et on lui demande si l'établissement est bloqué ou fermé. On
 * regarde ensuite, pour chaque seuil de probabilité, combien de vrais on garde et de faux on écarte.
 *
 *   npm run eval:judge                      # simulation : nombre d'appels et coût estimé (gratuit)
 *   npm run eval:judge -- --run --limit 5   # essai sur 5 signalements, affiche la réponse brute
 *   npm run eval:judge -- --run             # tous les signalements jugés
 *
 * Option --focus : n'envoie que le titre et les phrases sur l'établissement (comme compare:judge) au lieu
 * de l'article entier, pour comparer les deux façons de présenter le texte à Jev.
 * Options : --csv (défaut audit-manuel.csv), --cache-texts (défaut .eval-prompt-cache.json),
 * --out (défaut eval-judge-report.json), --model (défaut jev-latest), --limit N.
 * Variables : TYPESAFE_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (chargées depuis
 * .env.backfill, .env.prod ou .env). Les réponses sont gardées dans .eval-judge-cache.json : relancer
 * ne rappelle pas Jev pour ce qui est déjà fait. Rien n'est écrit en base.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parseLabels } from './eval-prompt-lib.ts'
import { focusState } from './eval-judge-lib.ts'
import {
  JEV_USD_PER_INPUT_TOKEN,
  bestThreshold,
  buildQuestions,
  estimateTokens,
  parseJevResponse,
  sweep,
  type JudgeAnswer,
  type JudgedOutcome,
} from './eval-judge-lib.ts'

for (const f of ['.env.backfill', '.env.prod', '.env']) if (existsSync(f)) process.loadEnvFile(f)

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const RUN = process.argv.includes('--run')
const CSV = arg('csv') ?? 'audit-manuel.csv'
const TEXTS_FILE = arg('cache-texts') ?? '.eval-prompt-cache.json'
const CACHE_FILE = '.eval-judge-cache.json'
const OUT_FILE = arg('out') ?? 'eval-judge-report.json'
const MODEL = arg('model') ?? 'jev-latest'
const FOCUS = process.argv.includes('--focus')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} est requis (environnement ou .env.backfill / .env.prod / .env).`)
  return v
}

if (!existsSync(TEXTS_FILE))
  throw new Error(
    `${TEXTS_FILE} introuvable : lance d'abord « npm run eval:prompt » (il met les textes en cache).`,
  )
const texts = (JSON.parse(readFileSync(TEXTS_FILE, 'utf8')) as { texts: Record<string, string> })
  .texts
const cache: Record<string, JudgeAnswer> = existsSync(CACHE_FILE)
  ? (JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, JudgeAnswer>)
  : {}

interface Target {
  reportId: string
  url: string
  label: 'oui' | 'non'
  school: { name: string; city: string }
  observedAt: string
}

async function loadTargets(): Promise<Target[]> {
  const labels = parseLabels(readFileSync(CSV, 'utf8'))
  const supabase = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'))
  const info = new Map<string, { observed_at: string; name: string; city: string }>()
  for (let i = 0; i < labels.length; i += 50) {
    const { data, error } = await supabase
      .from('reports')
      .select('id, observed_at, schools(name, city)')
      .in(
        'id',
        labels.slice(i, i + 50).map((l) => l.id),
      )
    if (error) throw new Error(`reports : ${error.message}`)
    for (const r of data as unknown as {
      id: string
      observed_at: string
      schools: { name: string; city: string } | null
    }[])
      if (r.schools) info.set(r.id, { observed_at: r.observed_at, ...r.schools })
  }
  const out: Target[] = []
  for (const l of labels) {
    const r = info.get(l.id)
    const text = texts[l.url]
    if (!r || !text) continue
    out.push({
      reportId: l.id,
      url: l.url,
      label: l.blocage,
      school: { name: r.name, city: r.city },
      observedAt: r.observed_at,
    })
  }
  return out.slice(0, LIMIT)
}

const stateOf = (t: Target) =>
  FOCUS
    ? focusState({ title: '', text: texts[t.url] ?? '' }, t.school, t.observedAt.slice(0, 10))
    : `Article publié le ${t.observedAt.slice(0, 10)} :\n${texts[t.url] ?? ''}`
const keyOf = (t: Target) =>
  createHash('sha1')
    .update(`${MODEL}|${JSON.stringify(buildQuestions(t.school))}|${stateOf(t)}`)
    .digest('hex')
    .slice(0, 20)

async function ask(t: Target, first: boolean): Promise<JudgeAnswer> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env('TYPESAFE_API_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ state: stateOf(t), model: MODEL, questions: buildQuestions(t.school) }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Jev HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`)
  const json: unknown = await res.json()
  if (first) console.log('\nRéponse brute (premier appel) :', JSON.stringify(json).slice(0, 600))
  return parseJevResponse(json)
}

async function main() {
  const targets = await loadTargets()
  const todo = targets.filter((t) => !(keyOf(t) in cache))
  const tokens = estimateTokens(todo.map((t) => stateOf(t)))
  console.log(
    `${targets.length} signalements jugés avec texte en cache ; ${todo.length} appel(s) à faire, ≈ ${tokens} tokens ` +
      `(≈ ${(tokens * JEV_USD_PER_INPUT_TOKEN).toFixed(4)} $ au tarif annoncé).`,
  )
  if (!RUN) {
    console.log('Simulation seulement. Relancer avec --run (et --limit 5 pour un premier essai).')
    return
  }
  let first = true
  let next = 0
  async function worker() {
    while (next < todo.length) {
      const t = todo[next++] as Target
      try {
        const showRaw = first
        first = false
        cache[keyOf(t)] = await ask(t, showRaw)
      } catch (e) {
        console.error(`\n${t.reportId} : ${e instanceof Error ? e.message : String(e)}`)
        writeFileSync(CACHE_FILE, JSON.stringify(cache))
        process.exit(1)
      }
      process.stdout.write(`\r  ${next}/${todo.length}`)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  writeFileSync(CACHE_FILE, JSON.stringify(cache))
  console.log()

  const outcomes: (JudgedOutcome & { reportId: string; url: string; nature: string | null })[] =
    targets.map((t) => {
      const a = cache[keyOf(t)]
      return {
        reportId: t.reportId,
        url: t.url,
        label: t.label,
        probability: a?.probability ?? null,
        nature: a?.nature ?? null,
      }
    })
  const rows = sweep(outcomes, [0.3, 0.5, 0.6, 0.7, 0.8, 0.9])
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : '—')
  console.log('\nSeuil | vrais gardés | faux écartés')
  for (const r of rows)
    console.log(
      `${String(r.threshold).padEnd(5)} | ${String(r.trueKept).padStart(3)}/${r.trueTotal} (${pct(r.trueKept, r.trueTotal)}) | ${String(r.falseRemoved).padStart(3)}/${r.falseTotal} (${pct(r.falseRemoved, r.falseTotal)})`,
    )
  const best = bestThreshold(rows)
  console.log(
    best
      ? `→ Seuil ${best.threshold} : garde ${pct(best.trueKept, best.trueTotal)} des vrais et écarte ${pct(best.falseRemoved, best.falseTotal)} des faux.`
      : '→ Aucun seuil ne garde 95 % des vrais : le juge ne vaut pas la peine tel quel.',
  )
  const byNature = (label: 'oui' | 'non') => {
    const c: Record<string, number> = {}
    for (const o of outcomes.filter((x) => x.label === label))
      c[o.nature ?? '(sans réponse)'] = (c[o.nature ?? '(sans réponse)'] ?? 0) + 1
    return c
  }
  console.log('\nNature donnée par le juge :')
  console.log('  vrais :', JSON.stringify(byNature('oui')))
  console.log('  faux  :', JSON.stringify(byNature('non')))
  writeFileSync(OUT_FILE, JSON.stringify({ model: MODEL, rows, outcomes }, null, 1))
  console.log(`Détail : ${OUT_FILE}`)
}

await main()
