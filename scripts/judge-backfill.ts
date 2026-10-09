/**
 * Fait juger par Jev (TypeSafe AI) les signalements déjà en base et enregistre l'avis dans les colonnes
 * `judge_*` (mode observation : rien ne change sur le site). Même méthode que le collecteur, mais
 * l'article est relu en entier (la page), pas seulement le texte du flux.
 *
 *   npm run judge:backfill                      # simulation : volumes et coût estimé (gratuit)
 *   npm run judge:backfill -- --run --limit 20  # essai sur 20 signalements
 *   npm run judge:backfill -- --run             # tout ce qui n'a pas encore été essayé
 *   npm run judge:backfill -- --run --redo      # rejuge tout (après un changement de question)
 *   npm run judge:backfill -- --run --retry-unreadable   # retente les articles qui étaient illisibles
 *
 *   npm run judge:backfill -- --run --redo --status filtrant,leve   # rejuge seulement ces statuts
 *
 * Options : --limit N, --concurrency N (défaut 4), --model (défaut jev-1.13.0).
 * Variables (environnement ou .env.backfill) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TYPESAFE_API_KEY.
 * Relançable : un signalement déjà essayé (judged_at) est ignoré, sauf --redo. Un article illisible
 * (403, page vide) reçoit judged_at et pas de score, pour ne pas être relu à chaque passage.
 * Aucun appel Gemini ; Jev coûte quelques centimes pour toute la base.
 */
import { existsSync } from 'node:fs'
import { JEV_MODEL, MIN_JUDGE_CHARS, createJevJudge } from '../supabase/functions/_shared/judge.ts'
import { JEV_USD_PER_INPUT_TOKEN, estimateTokens } from './eval-judge-lib.ts'
import { parseArticle } from './audit-reports-lib.ts'

/** Lecture des articles comme un navigateur : France 3, La 1ère, La Provence… refusent un robot identifié ou un faux Googlebot (403). */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

for (const f of ['.env.backfill', '.env.prod', '.env']) if (existsSync(f)) process.loadEnvFile(f)

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const RUN = flag('run')
const REDO = flag('redo')
const RETRY = flag('retry-unreadable')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const CONCURRENCY = Number(arg('concurrency') ?? 4)
const MODEL = arg('model') ?? JEV_MODEL
const STATUSES = arg('status')?.split(',').filter(Boolean) ?? []
const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} est requis (environnement ou .env.backfill).`)
  return v
}

interface Row {
  id: string
  status: 'bloque' | 'filtrant' | 'leve'
  source_url: string
  observed_at: string
  schools: { name: string; city: string } | null
}

const BASE = env('SUPABASE_URL').replace(/\/$/, '')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = []
  const filter = REDO
    ? ''
    : RETRY
      ? '&judged_at=not.is.null&judge_score=is.null'
      : '&judged_at=is.null'
  for (let from = 0; ; from += 1000) {
    const res = await rest(
      `reports?select=id,status,source_url,observed_at,schools(name,city)` +
        `&moderation=eq.validated&hidden=eq.false&source_url=not.is.null` +
        `&source_url=not.ilike.*news.google.com*${filter}${STATUSES.length ? `&status=in.(${STATUSES.join(',')})` : ''}&order=observed_at.desc&offset=${from}&limit=1000`,
    )
    if (!res.ok) throw new Error(`reports : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as Row[]
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows.filter((r) => r.schools).slice(0, LIMIT)
}

const parisDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso))

async function readArticle(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'user-agent': BROWSER_UA,
        'accept-language': 'fr-FR',
      },
    })
    if (!res.ok) return null
    const a = parseArticle(await res.text())
    return a.text.length >= MIN_JUDGE_CHARS ? a : null
  } catch {
    return null
  }
}

async function main() {
  const rows = await loadRows()
  const articles = new Set(rows.map((r) => r.source_url)).size
  const tokens = estimateTokens(rows.map(() => 'x'.repeat(2200)))
  console.log(
    `${rows.length} signalements à juger (${articles} articles), ≈ ${tokens} tokens ≈ ${(tokens * JEV_USD_PER_INPUT_TOKEN).toFixed(4)} $ au tarif annoncé. Aucun appel Gemini.`,
  )
  if (!RUN) {
    console.log('Simulation seulement. Relancer avec --run (et --limit 20 pour un premier essai).')
    return
  }
  const judge = createJevJudge({ apiKey: env('TYPESAFE_API_KEY'), model: MODEL, timeoutMs: 30_000 })
  const cache = new Map<string, Promise<{ title: string; text: string } | null>>()
  let next = 0
  const done = { judged: 0, unreadable: 0, failed: 0 }
  let consecutiveFailures = 0
  async function worker() {
    while (next < rows.length && consecutiveFailures < 8) {
      const r = rows[next++] as Row
      if (!cache.has(r.source_url)) cache.set(r.source_url, readArticle(r.source_url))
      const article = await cache.get(r.source_url)
      let patch: Record<string, unknown>
      if (!article) {
        patch = { judged_at: new Date().toISOString(), judge_chars: 0, judge_score: null }
        done.unreadable++
      } else {
        const v = await judge({
          school: {
            name: (r.schools as NonNullable<Row['schools']>).name,
            city: (r.schools as NonNullable<Row['schools']>).city,
          },
          status: r.status,
          title: article.title,
          text: article.text,
          publishedDay: parisDay(r.observed_at),
        })
        if (!v) {
          done.failed++
          consecutiveFailures++
          continue
        }
        consecutiveFailures = 0
        patch = {
          judge_score: v.probability,
          judge_nature: v.nature,
          judge_level: v.level,
          judge_model: v.model,
          judged_at: new Date().toISOString(),
          judge_chars: v.chars,
        }
        done.judged++
      }
      const res = await rest(`reports?id=eq.${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      if (!res.ok)
        throw new Error(`update ${r.id} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
      process.stdout.write(
        `\r  ${next}/${rows.length} · jugés ${done.judged} · illisibles ${done.unreadable} · échecs ${done.failed}   `,
      )
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(
    `\nTerminé : ${done.judged} jugés, ${done.unreadable} illisibles, ${done.failed} échecs Jev (relançable).`,
  )
  if (consecutiveFailures >= 8)
    console.error('Arrêt : 8 échecs de Jev d’affilée (clé, quota ou panne). Relancer plus tard.')
}

await main()
