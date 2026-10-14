/** Variant-independent text helpers used to build the benchmark's references. */
import { norm } from '@manifeste/core'

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
}

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)

/**
 * Every visible line of a page, with no judgement about what is article and what is not:
 * scripts, styles and comments go, block boundaries become line breaks. It is the reference
 * for "was this reachable at all" and for finding lines that repeat across a site.
 */
export function naiveLines(html: string): string[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(
      /<\/?(p|div|li|ul|ol|br|h[1-6]|section|article|header|footer|nav|aside|tr|td|figure|figcaption|blockquote|main|form|button)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, ' ')
  return decode(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0)
}

/** A line as compared across pages: no accents, case or digits. */
export const lineKey = (line: string): string =>
  norm(line).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
