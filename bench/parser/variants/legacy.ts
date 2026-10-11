/**
 * Frozen copy of the parser production ran on `develop` (regex based, article text from
 * <article>/<main>). Kept as a baseline so every benchmark run compares against the same code.
 * Do not improve it. The original comments were French and are left out.
 */
import type { ParserVariant } from './types.ts'

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

export const legacy: ParserVariant = {
  name: 'legacy',
  description: 'regex parser of develop (production before the rework)',
  parse(html) {
    return {
      text: [extractPageContext(html), extractArticleText(html)].filter(Boolean).join('\n'),
      title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '',
      publishedAt: extractPublished(html),
    }
  },
}
