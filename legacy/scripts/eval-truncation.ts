/**
 * Banc d'essai : couper le texte envoyé à l'extraction (6000 caractères aujourd'hui) fait-il
 * perdre des faits ? On reprend les articles connus de la production, on reconstitue le texte
 * comme la collecte (même enrichissement : titre, résumé et corps de l'article), puis on compare
 * l'extraction Gemini sur le texte complet et sur des textes coupés.
 *
 *   npm run eval:truncation                            # simulation : corpus, longueurs, économie
 *                                                      # estimée. N'appelle PAS Gemini (gratuit).
 *   npm run eval:truncation -- --run                   # lance Gemini (payant, voir le plan affiché)
 *   npm run eval:truncation -- --run --caps 1500,2000,3000 --model gemini-3.5-flash-lite
 *
 * Options : --caps (coupures testées, défaut 1500,2000,3000), --model (défaut GEMINI_MODEL, sans
 * modèle de secours pour ne pas mélanger les modèles), --rpm (défaut 30), --max-articles N,
 * --with-negatives (ajoute les articles jugés sans fait), --cache fichier, --out fichier.
 *
 * Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (et GEMINI_THINKING_BUDGET
 * comme en production), dans l'environnement ou dans .env.backfill.
 *
 * Lecture seule côté base. Les textes récupérés et les réponses de Gemini sont gardés dans un
 * fichier de cache local (rien n'est envoyé en base) : relancer reprend où on s'est arrêté, y
 * compris après un quota ou un crédit épuisé. Supprimer le cache pour changer de modèle.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { canonicalUrl, extractDomain } from '../supabase/functions/_shared/domain.ts'
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
import { isSafe, reportForCap, type ItemResult } from './eval-truncation-lib.ts'

if (existsSync('.env.backfill')) process.loadEnvFile('.env.backfill')

const BATCH = 60
const CHARS_PER_TOKEN = 3.5
/** Taille approximative du prompt système (caractères), répétée à chaque appel. */
const SYSTEM_CHARS = 2600

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} est requis (environnement ou .env.backfill).`)
  return v
}

const CAPS = (arg('caps') ?? '1500,2000,3000')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((n) => Number.isInteger(n) && n >= 200 && n < DEFAULT_TEXT_CHARS)
  .sort((a, b) => a - b)
const RUN = flag('run')
const RPM = Number(arg('rpm') ?? 30)
const CACHE_FILE = arg('cache') ?? '.eval-truncation-cache.json'
const OUT_FILE = arg('out') ?? 'eval-truncation-report.json'
const MIN_CERTAINTY: Certainty = (CERTAINTIES as readonly string[]).includes(
  process.env.COLLECT_MIN_CERTAINTY ?? '',
)
  ? (process.env.COLLECT_MIN_CERTAINTY as Certainty)
  : 'moyenne'

// ---------------------------------------------------------------------------------------------
// Cache local

interface Cache {
  texts: Record<string, string>
  runs: Record<string, ExtractedEvent[]>
}
const cache: Cache = existsSync(CACHE_FILE)
  ? (JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache)
  : { texts: {}, runs: {} }
const saveCache = () => writeFileSync(CACHE_FILE, JSON.stringify(cache))

// ---------------------------------------------------------------------------------------------
// Corpus : les articles connus de la production

interface Row {
  url: string
  title: string
  publishedAt: Date
  fromReports: boolean
  /** Longueur du texte réellement envoyé à l'époque (analyse des médias), si connue. */
  recordedChars?: number
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>
async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => Page<T>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(`${label} : ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

/** Domaines dont la page n'est pas l'article collecté : le texte réel n'est pas reconstituable. */
const SKIPPED_DOMAINS = /(^|\.)(news\.google\.com|t\.me|bsky\.app|google\.com)$/

async function loadCorpus(): Promise<{ rows: Row[]; skipped: number }> {
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const byUrl = new Map<string, Row>()
  let skipped = 0
  const add = (
    url: string | null,
    title: string | null,
    at: string | null,
    fromReports: boolean,
    recordedChars?: number | null,
  ) => {
    if (!url || !url.startsWith('https://')) return
    const key = canonicalUrl(url)
    const domain = extractDomain(key)
    if (!domain || SKIPPED_DOMAINS.test(domain)) {
      skipped++
      return
    }
    const prev = byUrl.get(key)
    if (prev) {
      prev.fromReports ||= fromReports
      prev.title ||= title ?? ''
      prev.recordedChars ??= recordedChars ?? undefined
      return
    }
    byUrl.set(key, {
      url: key,
      title: title ?? '',
      publishedAt: at ? new Date(at) : new Date(),
      fromReports,
      recordedChars: recordedChars ?? undefined,
    })
  }

  const reports = await fetchAll<{ source_url: string; observed_at: string }>('reports', (a, b) =>
    admin.from('reports').select('source_url, observed_at').order('id').range(a, b),
  )
  for (const r of reports) add(r.source_url, null, r.observed_at, true)

  const unmatched = await fetchAll<{ source_url: string; observed_at: string }>(
    'unmatched',
    (a, b) =>
      admin.from('unmatched_extractions').select('source_url, observed_at').order('id').range(a, b),
  )
  for (const r of unmatched) add(r.source_url, null, r.observed_at, true)

  const media = await fetchAll<{
    url: string
    title: string
    published_at: string
    text_chars: number | null
  }>('media_analyses', (a, b) =>
    admin
      .from('media_analyses')
      .select('url, title, published_at, text_chars')
      .order('url')
      .range(a, b),
  )
  for (const r of media) add(r.url, r.title, r.published_at, false, r.text_chars)

  const queue = await fetchAll<{ url: string; title: string | null; published_at: string }>(
    'backfill_queue',
    (a, b) =>
      admin.from('backfill_queue').select('url, title, published_at').order('id').range(a, b),
  )
  for (const r of queue) add(r.url, r.title, r.published_at, false)

  const outcomes = [
    'rattache',
    'non_rattache',
    'certitude_faible',
    ...(flag('with-negatives') ? ['aucun_fait'] : []),
  ]
  const logs = await fetchAll<{ url: string }>('collector_item_logs', (a, b) =>
    admin.from('collector_item_logs').select('url').in('outcome', outcomes).order('id').range(a, b),
  )
  for (const r of logs) add(r.url, null, null, false)

  const max = Number(arg('max-articles') ?? Infinity)
  return { rows: [...byUrl.values()].slice(0, max), skipped }
}

// ---------------------------------------------------------------------------------------------
// Textes : même enrichissement que la collecte

async function loadTexts(rows: Row[]): Promise<void> {
  const todo = rows.filter((r) => cache.texts[r.url] === undefined)
  console.log(`Textes : ${rows.length - todo.length} en cache, ${todo.length} à récupérer.`)
  for (let i = 0; i < todo.length; i += 25) {
    const chunk = todo.slice(i, i + 25)
    const items: ScrapedItem[] = chunk.map((r) => ({
      externalId: r.url,
      url: r.url,
      text: r.title,
      publishedAt: r.publishedAt,
    }))
    const enriched = await enrichItems(fetch, items)
    enriched.forEach((e, k) => {
      cache.texts[(chunk[k] as Row).url] = e.text.slice(0, DEFAULT_TEXT_CHARS)
    })
    saveCache()
    process.stdout.write(`\r  ${Math.min(i + 25, todo.length)}/${todo.length}`)
  }
  if (todo.length) console.log()
}

const median = (v: number[]) =>
  v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—')

// ---------------------------------------------------------------------------------------------

async function main() {
  console.log(`Coupures testées : ${CAPS.join(', ')} (référence : ${DEFAULT_TEXT_CHARS}).`)
  if (CAPS.length === 0) throw new Error('--caps : au moins une valeur entre 200 et 5999.')

  const { rows, skipped } = await loadCorpus()
  console.log(
    `Corpus : ${rows.length} articles distincts (${rows.filter((r) => r.fromReports).length} à signal en production ; ${skipped} liens ignorés : Google Actualités, Telegram, Bluesky).`,
  )
  await loadTexts(rows)

  const lengths = rows.map((r) => (cache.texts[r.url] ?? '').length)
  const withText = rows.filter((_, i) => (lengths[i] ?? 0) > 0)
  console.log(`\nLongueur du texte envoyé (${withText.length} articles lus) :`)
  const sorted = lengths.filter((l) => l > 0)
  console.log(
    `  médiane ${median(sorted)} · p90 ${[...sorted].sort((a, b) => a - b)[Math.floor(sorted.length * 0.9)] ?? 0} · max ${Math.max(0, ...sorted)}`,
  )
  const known = rows.filter((r) => r.recordedChars && (cache.texts[r.url] ?? '').length > 0)
  if (known.length)
    console.log(
      `  fidélité : sur ${known.length} articles dont la longueur d'origine est connue, le texte reconstitué en fait ${median(known.map((r) => Math.round((100 * (cache.texts[r.url] ?? '').length) / (r.recordedChars as number))))} % (médiane).`,
    )
  const minCapForCoverage = CAPS[0] as number
  const unreadable = rows.filter(
    (r) =>
      (r.recordedChars ?? 0) > minCapForCoverage &&
      (cache.texts[r.url] ?? '').length <= minCapForCoverage,
  ).length
  if (unreadable)
    console.log(
      `  couverture : ${unreadable} articles de plus de ${minCapForCoverage} caractères en production n'ont pas pu être relus ici (accès bloqué, abonnés) : ils ne sont pas testés.`,
    )
  const totalChars = sorted.reduce((a, b) => a + b, 0)
  for (const cap of CAPS) {
    const over = sorted.filter((l) => l > cap).length
    const cut = sorted.reduce((a, l) => a + Math.min(l, cap), 0)
    console.log(
      `  coupure ${cap} : ${over} articles touchés (${pct(over, sorted.length)}), entrée -${pct(totalChars - cut, totalChars)}`,
    )
  }

  // Les éléments dont le texte tient dans la plus petite coupure ont la même entrée partout.
  const minCap = CAPS[0] as number
  const affected = rows.filter((r) => (cache.texts[r.url] ?? '').length > minCap)
  const batches: Row[][] = []
  for (let i = 0; i < affected.length; i += BATCH) batches.push(affected.slice(i, i + BATCH))
  const variants = ['base', 'rerun', ...CAPS.map((c) => `cap${c}`)]
  const inputChars = (cap: number) =>
    affected.reduce((a, r) => a + Math.min((cache.texts[r.url] ?? '').length, cap), 0) +
    batches.length * SYSTEM_CHARS
  const estTokens =
    (2 * inputChars(DEFAULT_TEXT_CHARS) + CAPS.reduce((a, c) => a + inputChars(c), 0)) /
    CHARS_PER_TOKEN
  console.log(
    `\nPlan Gemini : ${affected.length} articles plus longs que ${minCap}, ${batches.length} lots de ${BATCH} × ${variants.length} variantes = ${batches.length * variants.length} appels, ≈ ${Math.round(estTokens / 1000)} K tokens d'entrée au total.`,
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
  console.log(
    `Modèle : ${model}${process.env.GEMINI_THINKING_BUDGET ? ` (réflexion ${process.env.GEMINI_THINKING_BUDGET})` : ''}`,
  )

  const results = new Map<string, ItemResult>()
  for (const r of affected)
    results.set(r.url, {
      url: r.url,
      length: (cache.texts[r.url] ?? '').length,
      fromReports: r.fromReports,
      base: [],
      rerun: [],
      byCap: {},
    })

  let calls = 0
  for (const [index, group] of batches.entries()) {
    const batch = group.map((r, i) => ({
      id: String(i),
      item: {
        externalId: r.url,
        url: r.url,
        text: cache.texts[r.url] ?? '',
        publishedAt: r.publishedAt,
      } satisfies ScrapedItem,
    }))
    const ids = new Set(batch.map((b) => b.id))
    const batchKey = createHash('sha1')
      .update(`${model}|${batch.map((b) => b.item.url).join('|')}`)
      .digest('hex')
      .slice(0, 16)
    for (const variant of variants) {
      const cap = variant.startsWith('cap') ? Number(variant.slice(3)) : DEFAULT_TEXT_CHARS
      const key = `${variant}:${batchKey}`
      let events = cache.runs[key]
      if (!events) {
        const startedAt = Date.now()
        try {
          events = parseExtraction(await client.generate(extractionRequest(batch, cap)), ids)
        } catch (e) {
          saveCache()
          const message = e instanceof Error ? e.message : String(e)
          console.error(
            `\nArrêt au lot ${index + 1}/${batches.length} (${variant}) : ${message}${isBillingBlocked(e) || isQuotaExhausted(message) ? "\nRelancer plus tard : le cache reprend où on s'est arrêté." : ''}`,
          )
          process.exit(1)
        }
        cache.runs[key] = events
        saveCache()
        calls++
        const wait = 60_000 / RPM - (Date.now() - startedAt)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        process.stdout.write(`\r  lot ${index + 1}/${batches.length} · ${variant}      `)
      }
      for (const e of events) {
        const item = results.get((batch[Number(e.item_id)] as (typeof batch)[number]).item.url)
        if (!item) continue
        if (variant === 'base') item.base.push(e)
        else if (variant === 'rerun') item.rerun.push(e)
        else (item.byCap[cap] ??= []).push(e)
      }
    }
  }
  console.log(`\n${calls} appels Gemini (${formatUsage(totalUsage(client.usage))}).`)

  const items = [...results.values()]
  const texts = new Map(Object.entries(cache.texts))
  const reports = CAPS.map((cap) => reportForCap(cap, items, texts, MIN_CERTAINTY))
  console.log('\nRésultat (faits retenus = certitude ≥ ' + MIN_CERTAINTY + ') :')
  console.log(
    [
      'coupure',
      'touchés',
      'faits réf.',
      'perdus',
      'bruit',
      'vidés*',
      'perdus>coupure',
      'gagnés',
      'texte gardé',
      'verdict',
    ].join('\t'),
  )
  for (const r of reports)
    console.log(
      [
        r.cap,
        r.affected,
        r.baseEvents,
        r.lost,
        r.noiseLost,
        r.reportItemsEmptied,
        r.lostBeyondCut,
        r.gained,
        pct(r.keptShare * 100, 100),
        isSafe(r) ? 'SÛR' : 'PERTES',
      ].join('\t'),
    )
  console.log(
    '* vidés : articles à signal en production pour lesquels la coupure ne trouve plus aucun fait.\n  bruit : faits que la relance identique de la référence perd aussi (variabilité du modèle).',
  )
  const safe = reports.filter(isSafe)
  console.log(
    safe.length
      ? `\nPlus petite coupure sans perte : EXTRACTION_TEXT_CHARS=${safe[0]?.cap}`
      : "\nAucune coupure testée n'est sans perte : garder 6000, ou essayer des valeurs plus hautes (--caps 3500,4500).",
  )
  for (const r of reports.filter((x) => !isSafe(x)).slice(0, 2))
    for (const ex of r.examples.slice(0, 5))
      console.log(
        `  [${r.cap}] perdu : ${ex.school_name} (${ex.status}) ≈ position ${ex.offset} · ${ex.url}`,
      )
  writeFileSync(OUT_FILE, JSON.stringify({ model, caps: CAPS, reports }, null, 2))
  console.log(`\nRapport détaillé : ${OUT_FILE}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
