/**
 * The "fetch & normalise" stage: from what a source published to the text of the item. For press
 * feeds the feed only gives a title and a summary, so the article page is read and cleaned by
 * `@manifeste/parser`; posts and map points already carry their text.
 */
import { canonicalUrl, extractDomain, readText } from '@manifeste/core'
import { parse } from '@manifeste/parser'
import type { Blocked } from '@manifeste/parser'
import { isGoogleNewsUrl, resolveGoogleNewsUrls } from './googlenews.ts'
import { mapLimit, USER_AGENT } from './http.ts'
import type { FetchLike, SourceKind } from './types.ts'

export interface ReadInput {
  id: string
  kind: SourceKind
  url: string
  /** What the source itself said (title and summary for a feed). */
  text: string
  publishedAt: Date
  publisherDomain: string | null
}

export interface ReadOutput {
  id: string
  /** The real article URL (Google News links are decoded), canonical. */
  url: string
  publisherDomain: string | null
  publishedAt: Date
  title: string
  text: string
  /** How the text was found: feed, json-ld, article, gateway… */
  strategy: string
  /** Why the page itself could not be used, when it could not. */
  blocked: Blocked | null
  /** Characters of article text read from the page (0 when only the feed text is left). */
  pageChars: number
  /** The page fetch failed (network, HTTP error). */
  pageError: string | null
}

export interface ReaderOptions {
  fetchFn: FetchLike
  /** Ask a public reading gateway for the text of pages closed to robots (public URLs only). */
  gateway: boolean
  pageConcurrency?: number
  /** Longest text kept per item. */
  maxChars?: number
}

const PAGE_MAX_BYTES = 600_000
/** Below this much text from the feed, the page is worth reading (a bare title). */
const SHORT_FEED_TEXT = 400
const HOUR_MS = 3_600_000
const MAX_CHARS = 8_000

/** Lines of `extra` that `base` does not already have (compared without case). */
const newLines = (base: string, extra: string): string[] => {
  const known = new Set(base.split('\n').map((l) => l.trim().toLowerCase()))
  return extra.split('\n').filter((l) => l.trim() && !known.has(l.trim().toLowerCase()))
}

/**
 * The publication date to use: the page's when it is clearly older than the feed's (Google News
 * and some feeds give the date of the last indexing of yesterday's article). A live blog keeps the
 * feed's date: it is updated during the day.
 */
export function reconcilePublished(
  feed: Date,
  page: { publishedAt: Date | null; title: string },
): Date {
  if (!page.publishedAt) return feed
  if (/\b(en )?direct\b|\blive\b/i.test(page.title)) return feed
  const gap = feed.getTime() - page.publishedAt.getTime()
  return gap >= 6 * HOUR_MS && gap <= 5 * 24 * HOUR_MS ? page.publishedAt : feed
}

/** Keeps the paragraphs: the gateway also renders menus and cookie banners, which help nobody. */
export function cleanReadable(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) => l.length >= 50 && !/cookie|consentement|partenaires|publicit|newsletter/i.test(l),
    )
    .join('\n')
}

const READER_URL = 'https://r.jina.ai/'

/** Last resort for an article the site refuses to serve to a robot: a reading gateway. */
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

async function fetchPage(
  fetchFn: FetchLike,
  url: string,
): Promise<{ html: string } | { error: string }> {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      await res.body?.cancel()
      return { error: `HTTP ${res.status}` }
    }
    return { html: await readText(res, PAGE_MAX_BYTES) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Page problems that mean the page says nothing about the article (a paywall still has its start). */
const UNUSABLE = new Set([
  'bot-wall',
  'captcha',
  'access-denied',
  'consent-wall',
  'not-found',
  'empty',
])

export async function readItems(
  items: readonly ReadInput[],
  options: ReaderOptions,
): Promise<ReadOutput[]> {
  const { fetchFn } = options
  const maxChars = options.maxChars ?? MAX_CHARS
  const feeds = items.filter((i) => i.kind === 'rss')
  const decoded = await resolveGoogleNewsUrls(
    fetchFn,
    feeds.map((i) => i.url).filter(isGoogleNewsUrl),
  )

  return mapLimit(items, options.pageConcurrency ?? 5, async (item): Promise<ReadOutput> => {
    const base: ReadOutput = {
      id: item.id,
      url: item.url,
      publisherDomain: item.publisherDomain,
      publishedAt: item.publishedAt,
      title: item.text.split('\n')[0] ?? '',
      text: item.text.slice(0, maxChars),
      strategy: 'feed',
      blocked: null,
      pageChars: 0,
      pageError: null,
    }
    if (item.kind !== 'rss') return base
    // Whatever goes wrong with one item (a hostile page, a bug) is that item's problem, not the batch's.
    try {
      const real = decoded.get(item.url)
      const url = real ? canonicalUrl(real) : item.url
      const next: ReadOutput = {
        ...base,
        url,
        publisherDomain: item.publisherDomain ?? (real ? extractDomain(real) : null),
      }
      // A Google link that could not be decoded has no article behind it we can read.
      if (isGoogleNewsUrl(url)) return next

      const page = await fetchPage(fetchFn, url)
      if ('error' in page) {
        next.pageError = page.error
        return maybeGateway(next, item, options, maxChars)
      }
      let parsed: ReturnType<typeof parse>
      try {
        parsed = parse(page.html, url)
      } catch (e) {
        // A page that cannot be parsed is that page's problem: the rest of the batch goes on.
        next.pageError = `parse: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)
        return maybeGateway(next, item, options, maxChars)
      }
      next.blocked = parsed.blocked
      next.title = parsed.title || next.title
      next.publishedAt = reconcilePublished(item.publishedAt, {
        publishedAt: parsed.publishedAt,
        title: parsed.title,
      })
      if (parsed.blocked && UNUSABLE.has(parsed.blocked.reason))
        return maybeGateway(next, item, options, maxChars)

      const article = [parsed.description, parsed.text].filter(Boolean).join('\n')
      next.pageChars = parsed.text.length
      next.strategy = parsed.strategy
      // The feed's own lines first (the title is what the reader sees), then what the page adds.
      const extra = newLines(item.text, [parsed.title, article].filter(Boolean).join('\n'))
      next.text = [item.text, ...extra].join('\n').slice(0, maxChars)
      return next
    } catch (e) {
      return {
        ...base,
        pageError: `read: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
      }
    }
  })
}

/** For a page that could not be read: the gateway, if allowed and the feed text is only a title. */
async function maybeGateway(
  out: ReadOutput,
  item: ReadInput,
  options: ReaderOptions,
  maxChars: number,
): Promise<ReadOutput> {
  if (!options.gateway || item.text.length >= SHORT_FEED_TEXT) return out
  const text = await fetchReadable(options.fetchFn, out.url)
  if (text.length < SHORT_FEED_TEXT) return out
  const extra = newLines(item.text, text)
  return {
    ...out,
    text: [item.text, ...extra].join('\n').slice(0, maxChars),
    strategy: 'gateway',
    pageChars: text.length,
  }
}
