/**
 * Banc d'essai du prompt « strict » (GEMINI_STRICT_PROMPT=1) sur les signalements jugés à la main.
 *
 * L'audit manuel (audit-manuel.csv) dit, pour chaque signalement relu, si l'article affirme bien
 * que l'établissement est bloqué (blocage oui) ou non (incident, manifestation, récit…). On
 * relance l'extraction Gemini sur ces mêmes articles avec le prompt de base puis avec le prompt
 * strict, et on regarde :
 *   - parmi les signalements FAUX : combien le prompt strict écarte (c'est le but) ;
 *   - parmi les signalements VRAIS : combien il en perd (ce qu'on ne veut pas).
 *
 *   npm run eval:prompt                       # simulation : étiquettes, textes, plan (gratuit)
 *   npm run eval:prompt -- --run              # appelle Gemini (quelques dizaines de centimes)
 *   npm run eval:prompt -- --run --csv audit-manuel.csv --model gemini-3.5-flash-lite
 *
 * Options : --csv (défaut audit-manuel.csv), --model (défaut GEMINI_MODEL), --rpm (défaut 30),
 * --cache fichier, --out fichier.
 * Variables : GEMINI_API_KEY (et GEMINI_THINKING_BUDGET comme en production) ; VITE_SUPABASE_URL
 * et VITE_SUPABASE_ANON_KEY pour relire les signalements (clé publique). Chargées depuis
 * .env.backfill, .env.prod ou .env si présents. Lecture seule côté base ; relancer reprend grâce
 * au cache local.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { enrichItems } from '../supabase/functions/_shared/enrich.ts'
import {
  CERTAINTIES,
  DEFAULT_TEXT_CHARS,
  parseExtraction,
  type Certainty,
  type ExtractedEvent,
} from '../supabase/functions/_shared/extraction.ts'
import {
  createGeminiClient,
  extractionRequest,
  formatUsage,
  isBillingBlocked,
  thinkingBudgetFromEnv,
  totalUsage,
  DEFAULT_GEMINI_MODEL,
} from '../supabase/functions/_shared/gemini.ts'
import type { ScrapedItem } from '../supabase/functions/_shared/fetchers/types.ts'
import { isQuotaExhausted } from './backfill-lib.ts'
import { hasKeptEvent, parseLabels, summarize, type Outcome } from './eval-prompt-lib.ts'

for (const f of ['.env.backfill', '.env.prod', '.env']) if (existsSync(f)) process.loadEnvFile(f)

const BATCH = 60
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const RUN = process.argv.includes('--run')
const CSV = arg('csv') ?? 'audit-manuel.csv'
const RPM = Number(arg('rpm') ?? 30)
const CACHE_FILE = arg('cache') ?? '.eval-prompt-cache.json'
const OUT_FILE = arg('out') ?? 'eval-prompt-report.json'
const MIN_CERTAINTY: Certainty = (CERTAINTIES as readonly string[]).includes(
  process.env.COLLECT_MIN_CERTAINTY ?? '',
)
  ? (process.env.COLLECT_MIN_CERTAINTY as Certainty)
  : 'moyenne'
const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} est requis (environnement ou .env.backfill / .env.prod / .env).`)
  return v
}

interface Cache {
  texts: Record<string, string>
  runs: Record<string, ExtractedEvent[]>
}
const cache: Cache = existsSync(CACHE_FILE)
  ? (JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache)
  : { texts: {}, runs: {} }
const saveCache = () => writeFileSync(CACHE_FILE, JSON.stringify(cache))

interface Target {
  reportId: string
  blocage: 'oui' | 'non'
  school: { name: string; city: string }
}
interface Article {
  url: string
  publishedAt: Date
  targets: Target[]
}

async function loadArticles(): Promise<Article[]> {
  const labels = parseLabels(readFileSync(CSV, 'utf8'))
  console.log(`Étiquettes : ${labels.length} (oui/non) dans ${CSV}.`)
  const supabase = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'))
  const byId = new Map<string, { observed_at: string; name: string; city: string }>()
  for (let i = 0; i < labels.length; i += 50) {
    const ids = labels.slice(i, i + 50).map((l) => l.id)
    const { data, error } = await supabase
      .from('reports')
      .select('id, observed_at, schools(name, city)')
      .in('id', ids)
    if (error) throw new Error(`reports : ${error.message}`)
    for (const r of data as unknown as {
      id: string
      observed_at: string
      schools: { name: string; city: string } | null
    }[])
      if (r.schools) byId.set(r.id, { observed_at: r.observed_at, ...r.schools })
  }
  const byUrl = new Map<string, Article>()
  for (const l of labels) {
    const r = byId.get(l.id)
    if (!r) continue
    const art = byUrl.get(l.url) ?? {
      url: l.url,
      publishedAt: new Date(r.observed_at),
      targets: [],
    }
    art.targets.push({
      reportId: l.id,
      blocage: l.blocage,
      school: { name: r.name, city: r.city },
    })
    byUrl.set(l.url, art)
  }
  return [...byUrl.values()]
}

async function loadTexts(articles: Article[]): Promise<void> {
  const todo = articles.filter((a) => cache.texts[a.url] === undefined)
  console.log(`Textes : ${articles.length - todo.length} en cache, ${todo.length} à récupérer.`)
  for (let i = 0; i < todo.length; i += 25) {
    const chunk = todo.slice(i, i + 25)
    const items: ScrapedItem[] = chunk.map((a) => ({
      externalId: a.url,
      url: a.url,
      text: '',
      publishedAt: a.publishedAt,
    }))
    const enriched = await enrichItems(fetch, items)
    enriched.forEach((e, k) => {
      cache.texts[(chunk[k] as Article).url] = e.text.slice(0, DEFAULT_TEXT_CHARS)
    })
    saveCache()
    process.stdout.write(`\r  ${Math.min(i + 25, todo.length)}/${todo.length}`)
  }
  if (todo.length) console.log()
}

async function main() {
  const articles = await loadArticles()
  await loadTexts(articles)
  const usable = articles.filter((a) => (cache.texts[a.url] ?? '').length > 0)
  const targets = usable.reduce((n, a) => n + a.targets.length, 0)
  const batches: Article[][] = []
  for (let i = 0; i < usable.length; i += BATCH) batches.push(usable.slice(i, i + BATCH))
  console.log(
    `\n${usable.length} articles lisibles sur ${articles.length} (${targets} signalements jugés). Plan Gemini : ${batches.length} lots × 2 variantes = ${batches.length * 2} appels.`,
  )
  if (!RUN) {
    console.log('Simulation seulement. Relancer avec --run pour appeler Gemini (payant).')
    return
  }

  const model = arg('model') ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
  const client = createGeminiClient({
    apiKey: env('GEMINI_API_KEY'),
    models: [model],
    thinkingBudget: thinkingBudgetFromEnv(process.env.GEMINI_THINKING_BUDGET),
    fetchFn: fetch,
  })
  console.log(`Modèle : ${model}`)

  const events: Record<'base' | 'strict', Map<string, ExtractedEvent[]>> = {
    base: new Map(),
    strict: new Map(),
  }
  for (const [index, group] of batches.entries()) {
    const batch = group.map((a, i) => ({
      id: String(i),
      item: {
        externalId: a.url,
        url: a.url,
        text: cache.texts[a.url] ?? '',
        publishedAt: a.publishedAt,
      } satisfies ScrapedItem,
    }))
    const ids = new Set(batch.map((b) => b.id))
    const batchKey = createHash('sha1')
      .update(`${model}|${batch.map((b) => b.item.url).join('|')}`)
      .digest('hex')
      .slice(0, 16)
    for (const variant of ['base', 'strict'] as const) {
      const key = `${variant}:${batchKey}`
      let parsed = cache.runs[key]
      if (!parsed) {
        const startedAt = Date.now()
        try {
          parsed = parseExtraction(
            await client.generate(extractionRequest(batch, undefined, variant === 'strict')),
            ids,
          )
        } catch (e) {
          saveCache()
          const message = e instanceof Error ? e.message : String(e)
          console.error(
            `\nArrêt au lot ${index + 1}/${batches.length} (${variant}) : ${message}${isBillingBlocked(e) || isQuotaExhausted(message) ? "\nRelancer plus tard : le cache reprend où on s'est arrêté." : ''}`,
          )
          process.exit(1)
        }
        cache.runs[key] = parsed
        saveCache()
        const wait = 60_000 / RPM - (Date.now() - startedAt)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        process.stdout.write(`\r  lot ${index + 1}/${batches.length} · ${variant}      `)
      }
      for (const e of parsed) {
        const url = (batch[Number(e.item_id)] as (typeof batch)[number]).item.url
        events[variant].set(url, [...(events[variant].get(url) ?? []), e])
      }
    }
  }
  console.log(`\n${formatUsage(totalUsage(client.usage))}`)

  const outcomes: (Outcome & { reportId: string; url: string })[] = []
  for (const a of usable)
    for (const t of a.targets)
      outcomes.push({
        reportId: t.reportId,
        url: a.url,
        label: t.blocage,
        base: hasKeptEvent(events.base.get(a.url) ?? [], t.school, MIN_CERTAINTY),
        strict: hasKeptEvent(events.strict.get(a.url) ?? [], t.school, MIN_CERTAINTY),
      })
  const s = summarize(outcomes)
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)} %` : '—')
  console.log(`\nRésultat (fait retenu = certitude ≥ ${MIN_CERTAINTY}) :`)
  console.log(
    `  Signalements FAUX (blocage « non », n=${s.faux.n}) : prompt de base les produit dans ${pct(s.faux.baseKept, s.faux.n)} des cas, prompt strict ${pct(s.faux.strictKept, s.faux.n)} ; le strict en écarte ${s.faux.removed}.`,
  )
  console.log(
    `  Signalements VRAIS (blocage « oui », n=${s.vrais.n}) : prompt de base les retrouve dans ${pct(s.vrais.baseKept, s.vrais.n)} des cas, prompt strict ${pct(s.vrais.strictKept, s.vrais.n)} ; le strict en perd ${s.vrais.lost}.`,
  )
  console.log(
    s.vrais.lost <= Math.max(1, Math.round(s.vrais.baseKept * 0.03)) && s.faux.removed > 0
      ? '  → Le prompt strict écarte des faux sans (ou presque sans) perdre de vrais : on peut l’activer.'
      : '  → À examiner avant d’activer : voir le détail dans le rapport.',
  )
  writeFileSync(OUT_FILE, JSON.stringify({ model, summary: s, outcomes }, null, 1))
  console.log(`Détail : ${OUT_FILE}`)
}

await main()
