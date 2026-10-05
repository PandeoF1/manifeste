// Titre et résumé d'une page web (balises Open Graph, description, <title>).
import type { FetchLike } from './fetchers/types.ts'
import { USER_AGENT } from './fetchers/types.ts'

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

export async function fetchPageContext(fetchFn: FetchLike, url: string): Promise<string> {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return ''
    return extractPageContext(await res.text())
  } catch {
    return ''
  }
}
