/**
 * Diagnostic de la résolution des liens Google Actualités (utile quand `backfill media` annonce
 * que toutes les pages sont illisibles). Prend 3 articles de la file et affiche, étape par étape,
 * ce que Google répond.
 *
 *   npm run diagnose:gnews
 */
import { existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  buildBatchBody,
  googleNewsArticleId,
  parseBatchResponse,
  parseDecodingParams,
} from '../supabase/functions/_shared/fetchers/googlenews.ts'

if (existsSync('.env.backfill')) process.loadEnvFile('.env.backfill')

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.')
const admin = createClient(url, key, { auth: { persistSession: false } })
const { data } = await admin
  .from('backfill_queue')
  .select('url')
  .is('media_done_at', null)
  .order('id')
  .limit(3)

for (const row of data ?? []) {
  const id = googleNewsArticleId(row.url)
  console.log(`\n— ${row.url.slice(0, 80)}…`)
  if (!id) {
    console.log('  lien Google illisible (identifiant introuvable)')
    continue
  }
  const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
    headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'fr-FR,fr;q=0.9' },
    redirect: 'follow',
  })
  const html = await page.text()
  const params = parseDecodingParams(id, html.slice(-150_000)) ?? parseDecodingParams(id, html)
  console.log(
    `  1. page Google : HTTP ${page.status}, ${html.length} octets, adresse finale ${new URL(page.url).host}`,
  )
  console.log(
    `     paramètres de décodage : ${params ? 'trouvés' : 'ABSENTS'}${/consent|captcha|unusual traffic/i.test(html.slice(0, 5000)) ? ' (page de consentement ou de blocage)' : ''}`,
  )
  if (!params) continue
  // Trois variantes de la requête de décodage : si l'une passe quand la première répond 429,
  // le blocage vient de la forme de la requête et non d'un quota d'adresse.
  const cookies = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const variants: Array<[string, string, Record<string, string>]> = [
    ['simple', BATCH_URL, {}],
    [
      'avec paramètres d’URL',
      `${BATCH_URL}?rpcids=Fbv4je&source-path=%2Frss%2Farticles%2F${id}&hl=fr&gl=FR&rt=c`,
      { 'x-same-domain': '1' },
    ],
    ['avec cookies de la page', BATCH_URL, cookies ? { cookie: cookies } : {}],
  ]
  let real: string | null = null
  for (const [label, target, extra] of variants) {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': UA,
        origin: 'https://news.google.com',
        referer: 'https://news.google.com/',
        ...extra,
      },
      body: buildBatchBody([params]),
    })
    const text = await res.text()
    ;[real] = parseBatchResponse(text, 1)
    console.log(
      `  2. décodage (${label}) : HTTP ${res.status}, ${real ? `adresse réelle ${real.slice(0, 70)}…` : 'AUCUNE adresse'}`,
    )
    if (real) break
    console.log(`     réponse : ${text.slice(0, 160).replace(/\s+/g, ' ')}`)
    await new Promise((r) => setTimeout(r, 3000))
  }
  if (!real) continue
  const article = await fetch(real, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
  })
  console.log(
    `  3. page de l'éditeur : HTTP ${article.status}, ${(await article.text()).length} octets`,
  )
}
