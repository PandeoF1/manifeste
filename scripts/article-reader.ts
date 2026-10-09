// Lecture d'un article pour les scripts de rattrapage : la page comme un navigateur, puis, si le
// site refuse les robots (403), la passerelle de lecture publique.
import { MIN_JUDGE_CHARS } from '../supabase/functions/_shared/judge.ts'
import { fetchReadable } from '../supabase/functions/_shared/page.ts'
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

/** Texte venu de la passerelle (`reader`) : à garder seulement s'il parle de l'établissement (sinon page d'erreur). */
export async function readArticle(url: string): Promise<Article | null> {
  const direct = await readDirect(url)
  if (direct) return direct
  const text = await fetchReadable(fetch, url)
  return text.length >= MIN_JUDGE_CHARS ? { title: '', text, reader: true } : null
}
