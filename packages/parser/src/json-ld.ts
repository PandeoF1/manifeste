/**
 * JSON-LD (schema.org) blocks. Most French news sites publish a NewsArticle with its headline,
 * dates and often the whole article body: the cleanest source there is, when present.
 */
import { $$, clean, rawText, type Doc } from './dom.ts'

export interface ArticleLd {
  type: string
  headline: string
  articleBody: string
  datePublished: string
  dateModified: string
  isAccessibleForFree: boolean | null
  publisher: string
}

const ARTICLE_TYPES =
  /^(News|Report|Live|Blog|Social Media|Tech|Scholarly|Opinion|Review)?(Article|Posting|BlogPosting|Report|LiveBlogPosting)$/i

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Every object of every JSON-LD script, @graph included. Invalid JSON is skipped. */
export function jsonLdNodes(doc: Doc): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    nodes.push(object)
    if (object['@graph']) visit(object['@graph'])
  }
  for (const script of $$('script[type="application/ld+json"]', doc)) {
    const raw = rawText(script)
    try {
      visit(JSON.parse(raw))
    } catch {
      // Some sites leave a trailing comma or an unescaped control character: try once more.
      try {
        visit(JSON.parse(raw.replace(/\p{Cc}+/gu, ' ').replace(/,\s*([}\]])/g, '$1')))
      } catch {
        /* unreadable: ignored */
      }
    }
  }
  return nodes
}

const typeOf = (node: Record<string, unknown>): string => {
  const t = node['@type']
  return Array.isArray(t) ? (t.map(text).find((x) => ARTICLE_TYPES.test(x)) ?? text(t[0])) : text(t)
}

/** The article described by the page, if any (the one with the longest body wins). */
export function articleFromJsonLd(doc: Doc): ArticleLd | null {
  const articles = jsonLdNodes(doc)
    .filter((n) => ARTICLE_TYPES.test(typeOf(n)))
    .map((n): ArticleLd => {
      const free = n.isAccessibleForFree
      const publisher = n.publisher
      return {
        type: typeOf(n),
        headline: clean(text(n.headline) || text(n.name)),
        articleBody: text(n.articleBody),
        datePublished: text(n.datePublished),
        dateModified: text(n.dateModified),
        isAccessibleForFree:
          typeof free === 'boolean'
            ? free
            : free === 'False' || free === 'false'
              ? false
              : free === 'True' || free === 'true'
                ? true
                : null,
        publisher:
          publisher && typeof publisher === 'object'
            ? clean(text((publisher as Record<string, unknown>).name))
            : '',
      }
    })
  articles.sort((a, b) => b.articleBody.length - a.articleBody.length)
  return articles[0] ?? null
}
