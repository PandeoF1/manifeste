// Audit des signalements validés : relit chaque article source et vérifie que l'établissement y est
// cité et que le jour retenu est celui du texte. Lecture seule (clé publique), rien n'est modifié.
//
//   npm run audit:reports              tous les articles lisibles
//   npm run audit:reports -- --limit 200
//
// Écrit audit-report.json (signalements douteux) ; le cache des pages est dans
// .audit-reports-cache.json (supprime-le pour relire les articles). Les liens Google Actualités
// ne peuvent pas être relus : ils sont comptés à part.
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  checkDate,
  dateCandidates,
  parseArticle,
  schoolMention,
  sentencesAbout,
  type ParsedArticle,
} from './audit-reports-lib.ts'

const CACHE = '.audit-reports-cache.json'
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis (.env).')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity

interface Row {
  id: string
  status: string
  source_url: string | null
  observed_at: string
  schools: { name: string; city: string } | null
}
type Cached = (ParsedArticle & { status: number }) | { status: number; error: string }

const supabase = createClient(url, key)
const rows: Row[] = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('reports')
    .select('id, status, source_url, observed_at, schools(name, city)')
    .eq('moderation', 'validated')
    .order('id')
    .range(from, from + 999)
  if (error) throw error
  rows.push(...(data as unknown as Row[]))
  if (data.length < 1000) break
}
const withUrl = rows.filter((r): r is Row & { source_url: string } => r.source_url !== null)
const google = withUrl.filter((r) => r.source_url.includes('news.google.com')).length
const readable = withUrl.filter((r) => !r.source_url.includes('news.google.com'))
const urls = [...new Set(readable.map((r) => r.source_url))].slice(0, limit)

const cache: Record<string, Cached> = existsSync(CACHE)
  ? (JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, Cached>)
  : {}
const todo = urls.filter((u) => !(u in cache))
let next = 0
async function worker() {
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
      cache[u] = res.ok
        ? { status: res.status, ...parseArticle(await res.text()) }
        : { status: res.status, error: `HTTP ${res.status}` }
    } catch (e) {
      cache[u] = { status: 0, error: e instanceof Error ? e.message.slice(0, 80) : 'erreur' }
    }
  }
}
console.log(`Lecture de ${todo.length} article(s) (${urls.length - todo.length} en cache)…`)
await Promise.all(Array.from({ length: 12 }, worker))
writeFileSync(CACHE, JSON.stringify(cache))

const parisDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso))
const flagged: unknown[] = []
const count = {
  lus: 0,
  nonLus: 0,
  ecole_absente: 0,
  datables: 0,
  coherents: 0,
  incoherents: 0,
  ecart2: 0,
}
for (const r of readable) {
  const a = cache[r.source_url]
  if (!a || !('text' in a) || a.text.length < 300 || !r.schools) {
    count.nonLus++
    continue
  }
  count.lus++
  const mention = schoolMention(`${a.title} ${a.text}`, r.schools)
  if (mention === 'non') {
    count.ecole_absente++
    flagged.push({
      id: r.id,
      probleme: 'école absente du texte',
      url: r.source_url,
      ecole: r.schools.name,
      ville: r.schools.city,
    })
  }
  if (!a.published || Number.isNaN(Date.parse(a.published))) continue
  const about = sentencesAbout(a.text, r.schools)
  const verdict = checkDate(
    parisDay(r.observed_at),
    dateCandidates(`${about.join(' ')} ${a.title}`, parisDay(a.published)),
  )
  if (verdict.kind === 'indetermine') continue
  count.datables++
  if (verdict.kind === 'coherent') count.coherents++
  else {
    count.incoherents++
    if (verdict.gapDays >= 2) count.ecart2++
    flagged.push({
      id: r.id,
      probleme: `jour incohérent (écart ${verdict.gapDays} j)`,
      url: r.source_url,
      ecole: r.schools.name,
      jour_retenu: parisDay(r.observed_at),
      jours_du_texte: verdict.candidates,
      statut: r.status,
    })
  }
}
writeFileSync('audit-report.json', JSON.stringify(flagged, null, 1))
console.log(
  `\nSignalements validés : ${rows.length} (dont ${google} liens Google Actualités, non relisibles)`,
)
console.log(`Articles relus : ${count.lus} signalements (${count.nonLus} illisibles ou bloqués)`)
console.log(`École absente du texte : ${count.ecole_absente}`)
const pct = count.datables ? Math.round((count.coherents * 100) / count.datables) : 0
console.log(
  `Jour vérifiable : ${count.datables}, cohérents : ${count.coherents} (${pct} %), incohérents : ${count.incoherents} dont ${count.ecart2} à 2 jours ou plus`,
)
console.log('Détail des cas douteux : audit-report.json')
