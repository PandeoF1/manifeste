/**
 * Relit avec Gemini les signalements dont l'IA n'avait vu qu'un titre (site fermé aux robots) : la page
 * est lue en entier (navigateur, puis passerelle de lecture), Gemini refait l'extraction sur le texte
 * complet, et on compare avec ce qui est en base. Cible : les signalements de presse sans avis de Jev
 * (texte trop court ou illisible au moment de la collecte).
 *
 *   npm run reextract                         # analyse : écrit reextract-report.md, ne modifie rien
 *   npm run reextract -- --limit 30           # essai sur 30 signalements
 *   npm run reextract -- --browser            # lit aussi les pages fermées aux robots avec Chromium (Playwright)
 *   npm run reextract -- --apply              # corrige les statuts qui diffèrent (sauvegarde locale avant)
 *   npm run reextract -- --apply --no-lift    # ne passe aucun signalement en « levé » (à relire à la main)
 *   npm run reextract -- --apply --hide-no-event   # masque aussi ceux où Gemini ne voit aucun fait pour l'établissement
 *
 * Résultats possibles par signalement : confirmé (même établissement, même statut), statut différent,
 * aucun fait pour l'établissement, à voir à la main (blocage dans la commune sans nom reconnu), illisible. Rien n'est supprimé : « masquer » met hidden = true
 * (réversible) et la sauvegarde `reextract-backup-*.json` garde l'état d'avant.
 * Les dates ne sont pas touchées. Après un --apply, lancer `npm run judge:backfill -- --run --unjudged`
 * pour que Jev juge le texte complet.
 *
 * Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (+ GEMINI_MODEL, comme la collecte).
 * Un cache local (.reextract-cache.json) évite de relire les pages et de rappeler Gemini à la relance.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { recordAiUsage, usageRows } from '../supabase/functions/_shared/ai-usage.ts'
import { mapLimit } from '../supabase/functions/_shared/collector-utils.ts'
import type { ExtractedEvent } from '../supabase/functions/_shared/extraction.ts'
import {
  createExtractor,
  modelsFromEnv,
  textCharsFromEnv,
  thinkingBudgetFromEnv,
} from '../supabase/functions/_shared/gemini.ts'
import { matchSchool, sentencesAbout } from '../supabase/functions/_shared/school-text.ts'
import { isQuotaExhausted } from './backfill-lib.ts'
import { closeBrowser, readArticle } from './article-reader.ts'

for (const f of ['.env.backfill', '.env.prod', '.env']) if (existsSync(f)) process.loadEnvFile(f)

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const APPLY = flag('apply')
const HIDE = flag('hide-no-event')
const NO_LIFT = flag('no-lift')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const BATCH = 12
const CACHE = '.reextract-cache.json'
const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} est requis (environnement ou .env.backfill).`)
  return v
}

interface Row {
  id: string
  status: 'bloque' | 'filtrant' | 'leve'
  source_url: string
  published_at: string | null
  observed_at: string
  schools: { name: string; city: string } | null
}
type Outcome = 'confirme' | 'statut' | 'aucun' | 'ambigu' | 'illisible'
interface Cached {
  readable: boolean
  title: string
  text: string
  /** Texte venu de la passerelle de lecture (à vérifier : ce peut être une page d'erreur). */
  reader: boolean
  events: ExtractedEvent[]
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
  for (let from = 0; ; from += 1000) {
    const res = await rest(
      `reports?select=id,status,source_url,published_at,observed_at,schools(name,city)` +
        `&moderation=eq.validated&hidden=eq.false&source_type=in.(presse,collecteur)` +
        `&source_url=not.is.null&source_url=not.ilike.*news.google.com*&judge_score=is.null` +
        `&order=observed_at.desc&offset=${from}&limit=1000`,
    )
    if (!res.ok) throw new Error(`reports : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as Row[]
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows.filter((r) => r.schools).slice(0, LIMIT)
}

async function main() {
  const rows = await loadRows()
  const urls = [...new Set(rows.map((r) => r.source_url))]
  console.log(`${rows.length} signalements sans avis de Jev, ${urls.length} articles à relire.`)
  const cache: Record<string, Cached> = existsSync(CACHE)
    ? (JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, Cached>)
    : {}
  const save = () => writeFileSync(CACHE, JSON.stringify(cache))

  // 1. Lecture des pages.
  const texts = new Map<string, { title: string; text: string; reader?: boolean }>()
  const todo = urls.filter((u) => !cache[u]?.readable)
  let read = 0
  await mapLimit(todo, 2, async (u) => {
    const a = await readArticle(u)
    if (a) texts.set(u, a)
    process.stdout.write(`\r  pages lues ${++read}/${todo.length}   `)
  })
  if (todo.length) console.log()

  // 2. Extraction Gemini sur le texte complet, par lots.
  const extractor = createExtractor({
    apiKey: env('GEMINI_API_KEY'),
    models: modelsFromEnv(process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODELS),
    thinkingBudget: thinkingBudgetFromEnv(process.env.GEMINI_THINKING_BUDGET),
    textChars: textCharsFromEnv(process.env.EXTRACTION_TEXT_CHARS),
    fetchFn: fetch,
  })
  const ids = [...texts.keys()]
  const dateOf = (u: string) => {
    const r = rows.find((x) => x.source_url === u)
    return new Date(r?.published_at ?? r?.observed_at ?? Date.now())
  }
  let quota = false
  for (let i = 0; i < ids.length && !quota; i += BATCH) {
    const part = ids.slice(i, i + BATCH)
    try {
      const events = await extractor.extract(
        part.map((u, k) => {
          const a = texts.get(u) as { title: string; text: string }
          return {
            id: `a${i + k}`,
            item: {
              externalId: `a${i + k}`,
              url: u,
              text: [a.title, a.text].filter(Boolean).join('\n'),
              publishedAt: dateOf(u),
            },
          }
        }),
      )
      part.forEach((u, k) => {
        const a = texts.get(u)
        cache[u] = {
          readable: true,
          title: a?.title ?? '',
          text: (a?.text ?? '').slice(0, 8000),
          reader: a?.reader === true,
          events: events.filter((e) => e.item_id === `a${i + k}`),
        }
      })
      save()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (isQuotaExhausted(message)) {
        quota = true
        console.error(
          '\nQuota Gemini épuisé : relancer plus tard (les pages déjà traitées sont gardées).',
        )
      } else console.error(`\nLot ${i / BATCH + 1} en échec : ${message.slice(0, 200)}`)
    }
    process.stdout.write(`\r  Gemini ${Math.min(i + BATCH, ids.length)}/${ids.length} articles   `)
    await new Promise((r) => setTimeout(r, 1500))
  }
  if (ids.length) console.log()
  save()
  try {
    await recordAiUsage(
      {
        rpc: (fn, args) =>
          rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) }).then(async (r) => ({
            error: r.ok ? null : { message: `${r.status} ${await r.text()}` },
          })),
      },
      usageRows('backfill', extractor.usage),
    )
  } catch {
    // le compteur est facultatif
  }

  // 3. Comparaison avec la base.
  const verdicts = rows.map((r) => {
    const c = cache[r.source_url]
    const school = r.schools as NonNullable<Row['schools']>
    if (!c?.readable) return { r, outcome: 'illisible' as Outcome, found: undefined }
    const mine = c.events.filter((e) => matchSchool(e, school) === 'oui')
    const sameCity = c.events.some((e) => matchSchool(e, school) === 'ville')
    if (!mine.length) {
      // Texte de la passerelle qui ne parle pas de l'établissement : probablement une page d'erreur.
      const junk = c.reader && !sentencesAbout(c.text, school).length
      const outcome = junk ? 'illisible' : sameCity ? 'ambigu' : 'aucun'
      return { r, outcome: outcome as Outcome, found: undefined }
    }
    if (mine.some((e) => e.status === r.status))
      return { r, outcome: 'confirme' as Outcome, found: r.status }
    return { r, outcome: 'statut' as Outcome, found: mine[0]?.status }
  })
  const count = (o: Outcome) => verdicts.filter((v) => v.outcome === o).length
  const summary = `confirmés ${count('confirme')} · statut différent ${count('statut')} · aucun fait ${count('aucun')} · à voir à la main ${count('ambigu')} · illisibles ${count('illisible')}`
  console.log(summary)

  const md = [
    `# Relecture Gemini des signalements sans texte complet`,
    '',
    summary,
    '',
    ...(['statut', 'aucun', 'ambigu'] as const).flatMap((o) => [
      `## ${o === 'statut' ? 'Statut différent' : o === 'aucun' ? 'Aucun fait pour cet établissement' : 'À voir à la main (un blocage dans la commune, mais Gemini ne nomme pas cet établissement)'}`,
      '',
      ...verdicts
        .filter((v) => v.outcome === o)
        .map(
          (v) =>
            `- ${v.r.schools?.name} (${v.r.schools?.city}) — base : ${v.r.status}${v.found ? ` → Gemini : ${v.found}` : ''} — ${v.r.source_url}`,
        ),
      '',
    ]),
  ].join('\n')
  writeFileSync('reextract-report.md', md)
  console.log('Rapport : reextract-report.md')

  if (!APPLY) {
    console.log('Aucune modification (ajouter --apply pour corriger les statuts).')
    return
  }
  const changes = verdicts.filter(
    (v) =>
      (v.outcome === 'statut' && !(NO_LIFT && v.found === 'leve' && v.r.status !== 'leve')) ||
      (HIDE && v.outcome === 'aucun'),
  )
  const backup = `reextract-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`
  writeFileSync(
    backup,
    JSON.stringify(changes.map((v) => ({ id: v.r.id, status: v.r.status, hidden: false }))),
  )
  let done = 0
  for (const v of changes) {
    const patch = v.outcome === 'statut' ? { status: v.found } : { hidden: true }
    const res = await rest(`reports?id=eq.${v.r.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (res.ok) done++
    else console.error(`  ${v.r.id} : HTTP ${res.status}`)
  }
  console.log(`${done}/${changes.length} signalements modifiés. Sauvegarde : ${backup}`)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => closeBrowser())
