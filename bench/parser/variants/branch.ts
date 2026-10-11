/**
 * Frozen copy of the parser the `dev/better-html-parser` branch ran (regex based, with site
 * specific class and id blocklists). Kept as a baseline so every benchmark run compares against the same code.
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

function getElement(html: string, regex: string): string {
  const openRe = new RegExp(regex, 'i')
  const open = openRe.exec(html)
  if (!open) return ''

  const tag = open[1]
  const tagRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi')
  let depth = 1
  let i = open.index + open[0].length
  let m: RegExpExecArray | null

  while ((m = tagRe.exec(html.slice(i))) !== null) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) {
        const end = i + m.index + m[0].length
        return html.slice(open.index, end)
      }
    } else {
      depth++
    }
    i += tagRe.lastIndex
    tagRe.lastIndex = 0
  }
  return ''
}

function getElementByClassName(html: string, className: string) {
  return getElement(html, `<([a-zA-Z][a-zA-Z0-9]*)[^>]*class="[^"]*${className}[^"]*"[^>]*>`)
}
function getElementByXref(html: string, className: string) {
  return getElement(html, `<([a-zA-Z][a-zA-Z0-9]*)[^>]*x-ref="[^"]*${className}[^"]*"[^>]*>`)
}

function removeElement(html: string, regex: string): string {
  const openRe = new RegExp(regex, 'i')
  const open = openRe.exec(html)
  if (!open) return html

  const tag = open[1]
  const tagRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi')
  let depth = 1
  let i = open.index + open[0].length
  let m: RegExpExecArray | null

  while ((m = tagRe.exec(html.slice(i))) !== null) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) {
        const end = i + m.index + m[0].length
        return html.slice(0, open.index) + html.slice(end)
      }
    } else {
      depth++
    }
    i += tagRe.lastIndex
    tagRe.lastIndex = 0
  }
  return html
}

function removeElementById(html: string, className: string) {
  return removeElement(html, `<([a-zA-Z][a-zA-Z0-9]*)[^>]*id="[^"]*${className}[^"]*"[^>]*>`)
}
function removeElementByClassName(html: string, className: string) {
  return removeElement(html, `<([a-zA-Z][a-zA-Z0-9]*)[^>]*class="[^"]*${className}[^"]*"[^>]*>`)
}

export function extractArticleText(html: string, max = 3000): string {
  const scope =
    getElementByClassName(html, 'single-body') ||
    getElementByClassName(html, '\\barticle__body\\b') ||
    getElementByXref(html, '\\barticleBodyRef\\b') ||
    html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ||
    html.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ||
    html.match(/<body[\s>][\s\S]*<\/body>/i)?.[0] ||
    html
  const cleaned = scope.replace(
    /<(script|style|noscript|nav|aside|footer|form|figure|svg|button)[\s>][\s\S]*?<\/\1>/gi,
    ' ',
  )
  const black_words: RegExp[] = [
    /à lire aussi/i,
    /publicité/i,
    /Lire aussi/i,
    /Je m’abonne/i,
    /la suite de cet article/i,
  ]
  const black_class = [
    '\\bEditorialInfosPublication\\b',
    '\\bdeeplinkAndSocialNetworksWithBorder\\b',
    '\\bLocaleList\\b',
    'premium',
    '\\bentry-meta\\b',
  ]
  const black_id = [
    '\\brecommendedSection\\b',
    '\\binfoFeedSection\\b',
    '\\bIciBounceArticle\\b',
    '\\bSocialNetworks\\b',
    '\\bpopin__container\\b',
  ]

  const lines: string[] = []
  let length = 0

  let clean_html = cleaned

  for (const class_name of black_class) {
    clean_html = removeElementByClassName(clean_html, class_name)
  }
  for (const id of black_id) {
    clean_html = removeElementById(clean_html, id)
  }

  for (const m of clean_html.matchAll(/<(p|li|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const line = decodeEntities((m[2] ?? '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
    if (line.length < 3) continue
    if (black_words.some((re) => re.test(line))) continue

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

export const branch: ParserVariant = {
  name: 'branch',
  description: 'dev/better-html-parser branch (site blocklists, depth-aware regex extraction)',
  parse(html) {
    return {
      text: [
        'Page context',
        '',
        decodeEntities(extractPageContext(html)),
        '',
        '------',
        'ArticleText',
        decodeEntities(extractArticleText(html)),
      ]
        .filter(Boolean)
        .join('\n'),
      title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '',
      publishedAt: extractPublished(html),
    }
  },
}
