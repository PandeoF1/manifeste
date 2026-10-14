/**
 * Turns the HTML of a press article into clean text, a title, a publication date and a verdict
 * on whether the page is really the article. Pure: it never fetches, and the clock is an option.
 *
 *   const page = parse(html, url)
 *   page.text        // the article, one block per line
 *   page.publishedAt // when it was published, and page.publishedSource tells how we know
 *   page.blocked     // null for a normal article; otherwise why it cannot be trusted
 */
import { detectBlocked } from './blocked.ts'
import { extractContent } from './content.ts'
import { bodyOf, clean, langOf, loadDocument, meta, textOf, titleOf } from './dom.ts'
import { articleFromJsonLd } from './json-ld.ts'
import { readPublished } from './published.ts'
import { rulesFor } from './rules.ts'
import type { Block, ParsedPage } from './types.ts'

export type { Block, Blocked, BlockedReason, DateSource, ParsedPage, Strategy } from './types.ts'
export { SITE_RULES, type SiteRule } from './rules.ts'

export interface ParseOptions {
  /** "Now" in milliseconds, to reject dates in the future. Defaults to the system clock. */
  now?: number
}

/** The body of a JSON-LD article is used when it is nearly as long as what the page shows. */
const LD_BODY_MIN_CHARS = 400
const LD_BODY_SHARE = 0.8

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Paragraphs of a JSON-LD body (they often come with newlines, sometimes as one block). */
function ldBlocks(body: string): Block[] {
  return body
    .replace(/<[^>]+>/g, '\n')
    .split(/\n+/)
    .map(clean)
    .filter((line) => line.length >= 3)
    .map((text) => ({ kind: 'paragraph' as const, text }))
}

export function parse(html: string, url: string, options: ParseOptions = {}): ParsedPage {
  const now = options.now ?? Date.now()
  const doc = loadDocument(html)
  const ld = articleFromJsonLd(doc)
  const found = extractContent(doc, rulesFor(hostOf(url)))

  let blocks = found.blocks
  let strategy = found.strategy
  if (
    ld &&
    ld.articleBody.length >= LD_BODY_MIN_CHARS &&
    ld.articleBody.length >= LD_BODY_SHARE * found.chars
  ) {
    const fromLd = ldBlocks(ld.articleBody)
    if (fromLd.length > 0) {
      blocks = fromLd
      strategy = 'json-ld'
    }
  }
  const text = blocks.map((b) => (b.kind === 'list-item' ? `- ${b.text}` : b.text)).join('\n')

  const pageTitle = titleOf(doc)
  const title = ld?.headline || meta(doc, 'og:title') || pageTitle
  const visible = textOf(bodyOf(doc)).slice(0, 8000)
  const published = readPublished(doc, ld, visible, now)
  return {
    url,
    title,
    description:
      meta(doc, 'og:description') || meta(doc, 'description') || meta(doc, 'twitter:description'),
    siteName: meta(doc, 'og:site_name') || ld?.publisher || '',
    lang: langOf(doc),
    text,
    blocks,
    publishedAt: published.publishedAt,
    publishedSource: published.source,
    modifiedAt: published.modifiedAt,
    strategy,
    blocked: detectBlocked({ title: pageTitle || title, chars: text.length, html, visible, ld }),
  }
}
