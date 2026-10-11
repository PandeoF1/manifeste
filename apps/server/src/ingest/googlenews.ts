/**
 * Google News: finds the real URL of an article behind a news.google.com/rss/articles/<id> link.
 * That link is a JavaScript redirect page; the original URL comes from Google News' internal
 * "batchexecute" service (the method of the google-news-url-decoder libraries). Undocumented:
 * every failure is silent and the Google link is kept.
 */
import { mapLimit } from './http.ts'
import type { FetchLike } from './types.ts'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute'

export function isGoogleNewsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'news.google.com'
  } catch {
    return false
  }
}

/** Article id: last segment after /articles/ or /read/. */
export function googleNewsArticleId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname !== 'news.google.com') return null
    const parts = u.pathname.split('/').filter(Boolean)
    const kind = parts[parts.length - 2]
    return kind === 'articles' || kind === 'read' ? (parts[parts.length - 1] ?? null) : null
  } catch {
    return null
  }
}

export interface DecodingParams {
  id: string
  signature: string
  timestamp: string
}

/** Signature and timestamp found in the article page (data-n-a-sg / -ts attributes). */
export function parseDecodingParams(id: string, html: string): DecodingParams | null {
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1]
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1]
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return null
  return { id, signature, timestamp }
}

export function buildBatchBody(params: ReadonlyArray<DecodingParams>): string {
  const requests = params.map((p) => [
    'Fbv4je',
    `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${p.id}",${p.timestamp},"${p.signature}"]`,
  ])
  return `f.req=${encodeURIComponent(JSON.stringify([requests]))}`
}

/** Decoded URLs, in request order (null when a response is unusable). */
export function parseBatchResponse(text: string, count: number): Array<string | null> {
  const out: Array<string | null> = new Array(count).fill(null)
  const chunk = text.split('\n\n')[1]
  if (!chunk) return out
  let parsed: unknown
  try {
    parsed = JSON.parse(chunk)
  } catch {
    return out
  }
  if (!Array.isArray(parsed)) return out
  const responses = parsed.filter(
    (d): d is unknown[] =>
      Array.isArray(d) && (d[0] === 'wrb.fr' || d[0] === 'w779db') && d[1] === 'Fbv4je',
  )
  responses.slice(0, count).forEach((r, i) => {
    try {
      const inner = JSON.parse(String(r[2])) as unknown[]
      const url = inner[1]
      if (typeof url === 'string' && url.startsWith('https://')) out[i] = url
    } catch {
      // unusable response: keep the Google link
    }
  })
  return out
}

/** Decodes a batch of Google News links: a map from Google link to real URL (decoded ones only). */
export async function resolveGoogleNewsUrls(
  fetchFn: FetchLike,
  urls: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  const ids = [...new Set(urls)]
    .map((url) => ({ url, id: googleNewsArticleId(url) }))
    .filter((x): x is { url: string; id: string } => x.id !== null)

  const params: Array<DecodingParams & { url: string }> = []
  await Promise.all(
    ids.map(async ({ url, id }) => {
      try {
        const res = await fetchFn(`https://news.google.com/rss/articles/${id}`, {
          headers: {
            'user-agent': BROWSER_UA,
            accept: 'text/html',
            'accept-language': 'fr-FR,fr;q=0.9',
          },
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return
        // The attributes are at the end of the page (~600 kB): read it all, looking at the end first.
        const html = await res.text()
        const p = parseDecodingParams(id, html.slice(-150_000)) ?? parseDecodingParams(id, html)
        if (p) params.push({ ...p, url })
      } catch {
        // page unavailable
      }
    }),
  )

  // One request per article: Google returns the answers of a batch out of order, with no id to
  // tell them apart (checked on the real service).
  await mapLimit(params, 4, async (p) => {
    try {
      const res = await fetchFn(BATCH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'user-agent': BROWSER_UA,
          origin: 'https://news.google.com',
          referer: 'https://news.google.com/',
        },
        body: buildBatchBody([p]),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return
      const [url] = parseBatchResponse(await res.text(), 1)
      if (url) resolved.set(p.url, url)
    } catch {
      // service unavailable: Google link kept
    }
  })
  return resolved
}
