// Lecture d'un article pour les scripts de rattrapage : la page comme un navigateur, puis, si le
// site refuse les robots (403), la passerelle de lecture publique.
import { MIN_JUDGE_CHARS } from '../supabase/functions/_shared/judge.ts'
import { cleanReadable, fetchReadable } from '../supabase/functions/_shared/page.ts'
import { parseArticle } from './audit-reports-lib.ts'

/** France 3, La 1ère, La Provence… refusent un robot identifié ou un faux Googlebot (403). */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export type Article = { title: string; text: string; reader?: boolean }

async function readDirect(url: string): Promise<Article | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { 'user-agent': BROWSER_UA, 'accept-language': 'fr-FR' },
    })
    if (!res.ok) return null
    const a = parseArticle(await res.text())
    return a.text.length >= MIN_JUDGE_CHARS ? a : null
  } catch {
    return null
  }
}

const USE_BROWSER = process.argv.includes('--browser')

/* eslint-disable @typescript-eslint/no-explicit-any */
let browserPromise: Promise<any> | null = null

/** Chromium piloté par Playwright (facultatif : `npm i -D playwright && npx playwright install chromium`). */
async function launchBrowser(): Promise<any> {
  const name = 'playwright'
  const pw: any = await import(name).catch(() => {
    throw new Error(
      '--browser demande Playwright : npm i -D playwright && npx playwright install chromium',
    )
  })
  return pw.chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] })
}

async function readBrowser(url: string): Promise<Article | null> {
  try {
    browserPromise ??= launchBrowser()
    const browser = await browserPromise
    const ctx = await browser.newContext({ locale: 'fr-FR', userAgent: BROWSER_UA })
    try {
      const page = await ctx.newPage()
      const res = await page.goto(url, { timeout: 25_000, waitUntil: 'domcontentloaded' })
      if (!res || res.status() >= 400) return null
      await page.waitForTimeout(2000)
      const title: string = await page.title()
      const body: string = await page.evaluate(() =>
        [...document.querySelectorAll('h1, h2, h3, p, li')]
          .map((e) => (e as HTMLElement).innerText)
          .join('\n'),
      )
      const text = cleanReadable(body)
      return text.length >= MIN_JUDGE_CHARS ? { title, text } : null
    } finally {
      await ctx.close()
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('--browser')) throw e
    return null
  }
}

/** À appeler en fin de script quand `--browser` est utilisé. */
export async function closeBrowser(): Promise<void> {
  if (browserPromise) await (await browserPromise).close().catch(() => undefined)
}

/** Texte venu de la passerelle (`reader`) : à garder seulement s'il parle de l'établissement (sinon page d'erreur). */
export async function readArticle(url: string): Promise<Article | null> {
  const direct = await readDirect(url)
  if (direct) return direct
  // Vrai navigateur (à la demande) : passe les protections simples, sans service tiers.
  if (USE_BROWSER) {
    const viaBrowser = await readBrowser(url)
    if (viaBrowser) return viaBrowser
  }
  // La passerelle limite le débit (≈ 20 requêtes par minute sans clé) : on retente après une pause.
  for (const wait of [0, 4000, 10_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    const text = await fetchReadable(fetch, url)
    if (text.length >= MIN_JUDGE_CHARS) return { title: '', text, reader: true }
  }
  return null
}
