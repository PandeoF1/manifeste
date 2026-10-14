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
  // Certaines pages encodent deux fois (« lyc&amp;eacute;es ») : seconde passe si besoin.
  const once = decodeEntitiesOnce(s)
  return /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(once) ? decodeEntitiesOnce(once) : once
}

function decodeEntitiesOnce(s: string): string {
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

/** Date de publication de la page (meta article:published_time, JSON-LD, <time>), si lisible. */
export function extractPublished(html: string): Date | null {
  const head = html.slice(0, 200_000)
  const raw =
    metaContent(head, 'article:published_time') ??
    head.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ??
    head.match(/<time[^>]*datetime=["']([^"']+)/i)?.[1] ??
    null
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface PageInfo {
  context: string
  published: Date | null
  /** Titre de la page (pour reconnaître un article « en direct », mis à jour dans la journée). */
  title: string
}

export async function fetchPageInfo(fetchFn: FetchLike, url: string): Promise<PageInfo> {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { context: '', published: null, title: '' }
    const html = await readText(res, 600_000)
    return {
      context: [extractPageContext(html), extractArticleText(html)].filter(Boolean).join('\n'),
      published: extractPublished(html),
      title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '',
    }
  } catch {
    return { context: '', published: null, title: '' }
  }
}

/** Passerelle de lecture publique (rend le texte d'une page, sans cookies ni menus compliqués). */
const READER_URL = 'https://r.jina.ai/'

/** Garde les paragraphes : la passerelle rend aussi les menus et le bandeau de cookies, qui ne servent à rien au juge ni à l'IA. */
export function cleanReadable(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) => l.length >= 50 && !/cookie|consentement|partenaires|publicit|newsletter/i.test(l),
    )
    .join('\n')
}

/**
 * Dernier recours pour un article que le site refuse de servir à un robot (403) : on demande le texte
 * à une passerelle de lecture. Seul le lien d'un article public lui est envoyé, jamais de donnée
 * personnelle. Vide en cas d'échec. Sert au juge uniquement, jamais à l'extraction.
 */
export async function fetchReadable(fetchFn: FetchLike, url: string, max = 8000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return ''
  try {
    const res = await fetchFn(READER_URL + url, {
      headers: { accept: 'text/plain', 'x-return-format': 'text' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return ''
    return cleanReadable(await readText(res, 300_000)).slice(0, max)
  } catch {
    return ''
  }
}

export async function fetchPageContext(fetchFn: FetchLike, url: string): Promise<string> {
  return (await fetchPageInfo(fetchFn, url)).context
}

const HOUR_MS = 3_600_000

/**
 * Date de publication à utiliser : celle de la page quand elle est nettement plus ancienne que
 * celle du flux (Google Actualités et certains flux redonnent la date de dernière indexation d'un
 * article d'hier). Un article « en direct » garde la date du flux : il est mis à jour dans la journée.
 */
export function reconcilePublished(feed: Date, page: PageInfo): Date {
  if (!page.published) return feed
  if (/\b(en )?direct\b|\blive\b/i.test(page.title)) return feed
  const gap = feed.getTime() - page.published.getTime()
  return gap >= 6 * HOUR_MS && gap <= 5 * 24 * HOUR_MS ? page.published : feed
}
