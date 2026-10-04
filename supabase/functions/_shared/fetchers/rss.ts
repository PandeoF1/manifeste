import { XMLParser } from 'fast-xml-parser'
import { extractDomain } from '../domain.ts'
import { fetchText, type FetchLike, type ScrapedItem } from './types.ts'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
})

type Node = Record<string, unknown>

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function text(v: unknown): string {
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
  const links = asArray(entry.link as Node | Node[] | string)
  for (const l of links) {
    if (typeof l === 'string') return l
    const rel = l['@_rel']
    if (!rel || rel === 'alternate') return String(l['@_href'] ?? '')
  }
  return ''
}

/** Parse un flux RSS 2.0 ou Atom. Les éléments sans lien https ou sans date sont ignorés. */
export function parseFeed(xml: string): ScrapedItem[] {
  const doc = parser.parse(xml) as Node
  const out: ScrapedItem[] = []

  const rss = (doc.rss as Node | undefined)?.channel as Node | undefined
  for (const item of asArray(rss?.item as Node | Node[] | undefined)) {
    const url = text(item.link).trim()
    const date = new Date(text(item.pubDate) || text(item['dc:date']))
    const title = stripHtml(text(item.title))
    const description = stripHtml(text(item.description))
    const source = item.source as Node | undefined
    const publisherDomain =
      source && typeof source === 'object' && source['@_url']
        ? (extractDomain(String(source['@_url'])) ?? undefined)
        : undefined
    pushItem(out, text(item.guid) || url, url, [title, description], date, publisherDomain)
  }

  const feed = doc.feed as Node | undefined
  for (const entry of asArray(feed?.entry as Node | Node[] | undefined)) {
    const url = atomLink(entry).trim()
    const date = new Date(text(entry.published) || text(entry.updated))
    pushItem(
      out,
      text(entry.id) || url,
      url,
      [stripHtml(text(entry.title)), stripHtml(text(entry.summary) || text(entry.content))],
      date,
    )
  }
  return out
}

function pushItem(
  out: ScrapedItem[],
  externalId: string,
  url: string,
  parts: string[],
  publishedAt: Date,
  publisherDomain?: string,
) {
  if (!url.startsWith('https://') || Number.isNaN(publishedAt.getTime())) return
  const body = parts.filter(Boolean)
  // Google Actualités répète le titre dans la description : on dédoublonne.
  const textValue = [...new Set(body)].join('\n').slice(0, 4000)
  if (!textValue) return
  out.push({
    externalId: externalId.slice(0, 500),
    url,
    text: textValue,
    publishedAt,
    publisherDomain,
  })
}

export async function fetchRss(fetchFn: FetchLike, feedUrl: string): Promise<ScrapedItem[]> {
  return parseFeed(await fetchText(fetchFn, feedUrl))
}
