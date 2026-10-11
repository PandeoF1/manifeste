import { extractDomain } from '@manifeste/core'
import { XMLParser } from 'fast-xml-parser'
import { fetchText } from '../http.ts'
import { IdentifierError, type SourceAdapter, type ScrapedItem } from '../types.ts'

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
})

type Node = Record<string, unknown>

export const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]

export function text(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object' && '#text' in (v as Node)) return String((v as Node)['#text'] ?? '')
  return ''
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function atomLink(entry: Node): string {
  for (const l of asArray(entry.link as Node | Node[] | string)) {
    if (typeof l === 'string') return l
    const rel = l['@_rel']
    if (!rel || rel === 'alternate') return String(l['@_href'] ?? '')
  }
  return ''
}

function push(
  out: ScrapedItem[],
  externalId: string,
  url: string,
  parts: string[],
  publishedAt: Date,
  publisherDomain?: string,
) {
  if (!url.startsWith('https://') || Number.isNaN(publishedAt.getTime())) return
  // Google News repeats the title in the description: dedupe the lines.
  const body = [...new Set(parts.filter(Boolean))].join('\n').slice(0, 4000)
  if (!body) return
  out.push({
    externalId: externalId.slice(0, 500),
    url,
    text: body,
    publishedAt,
    ...(publisherDomain && { publisherDomain }),
  })
}

/** Parses an RSS 2.0 or Atom feed. Entries without an https link or a date are ignored. */
export function parseFeed(source: string): ScrapedItem[] {
  const doc = xml.parse(source) as Node
  const out: ScrapedItem[] = []
  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined
  for (const item of asArray(channel?.item as Node | Node[] | undefined)) {
    const url = text(item.link).trim()
    const origin = item.source as Node | undefined
    const publisher =
      origin && typeof origin === 'object' && origin['@_url']
        ? (extractDomain(String(origin['@_url'])) ?? undefined)
        : undefined
    push(
      out,
      text(item.guid) || url,
      url,
      [stripHtml(text(item.title)), stripHtml(text(item.description))],
      new Date(text(item.pubDate) || text(item['dc:date'])),
      publisher,
    )
  }
  for (const entry of asArray((doc.feed as Node | undefined)?.entry as Node | Node[] | undefined)) {
    const url = atomLink(entry).trim()
    push(
      out,
      text(entry.id) || url,
      url,
      [stripHtml(text(entry.title)), stripHtml(text(entry.summary) || text(entry.content))],
      new Date(text(entry.published) || text(entry.updated)),
    )
  }
  return out
}

export const rssAdapter: SourceAdapter = {
  kind: 'rss',
  label: 'RSS / Atom feed',
  normalize(input) {
    let url: URL
    try {
      url = new URL(input.trim())
    } catch {
      throw new IdentifierError('Invalid feed URL.')
    }
    if (url.protocol !== 'https:') throw new IdentifierError('The feed must be served over https.')
    return url.toString()
  },
  async discover(fetchFn, identifier) {
    return parseFeed(await fetchText(fetchFn, identifier))
  },
}
