// Titre et résumé d'une page web (balises Open Graph, description, <title>).
import type { FetchLike } from './fetchers/types.ts'
import { USER_AGENT } from './fetchers/types.ts'
import { readText } from './text.ts'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  laquo: '«',
  raquo: '»',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
}

function metaContent(html: string, key: string): string | null {
  // Les attributs peuvent être dans les deux ordres : property/name puis content, ou l'inverse.
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
    'i',
  )
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    'i',
  )
  return html.match(a)?.[1] ?? html.match(b)?.[1] ?? null
}

/**
 * Titre et résumé d'une page (balises Open Graph, description, <title>) : léger (pas de DOM
 * complet, donc peu de CPU) et suffisant pour un article de presse, un post Telegram ou Bluesky.
 */
export function extractPageContext(html: string): string {
  const head = html.slice(0, 200_000)
  const parts = [
    metaContent(head, 'og:title'),
    head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null,
    metaContent(head, 'og:description'),
    metaContent(head, 'description'),
    metaContent(head, 'twitter:description'),
  ]
    .filter((p): p is string => Boolean(p))
    .map((p) => decodeEntities(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return [...new Set(parts)].join('\n').slice(0, 1500)
}

/**
 * Corps d'un article : paragraphes, listes et intertitres de <article> (sinon <main>, sinon la
 * page), sans scripts, menus ni pied de page. Utile quand l'article dresse une liste de lycées.
 */
export function extractArticleText(html: string, max = 3000): string {
  const scope =
    html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ??
    html.match(/<body[\s>][\s\S]*<\/body>/i)?.[0] ??
    html
  const cleaned = scope.replace(
    /<(script|style|noscript|nav|aside|footer|form|figure|svg|button)[\s>][\s\S]*?<\/\1>/gi,
    ' ',
  )
  const lines: string[] = []
  let length = 0
  for (const m of cleaned.matchAll(/<(p|li|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const line = decodeEntities((m[2] ?? '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    if (line.length < 3) continue
    lines.push(m[1]?.toLowerCase() === 'li' ? `- ${line}` : line)
    length += line.length + 1
    if (length >= max) break
  }
  return [...new Set(lines)].join('\n').slice(0, max)
}

export async function fetchPageContext(fetchFn: FetchLike, url: string): Promise<string> {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return ''
    const html = await readText(res, 600_000)
    return [extractPageContext(html), extractArticleText(html)].filter(Boolean).join('\n')
  } catch {
    return ''
  }
}
