// Google Actualités : retrouve l'URL réelle d'un article derrière un lien
// news.google.com/rss/articles/<id>. Ce lien est une page de redirection en JavaScript ;
// l'URL d'origine s'obtient via le service interne « batchexecute » de Google News
// (même méthode que les bibliothèques google-news-url-decoder / googlenewsdecoder).
// Non documenté : tout échec est silencieux et l'on garde le lien Google.
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

/** Identifiant de l'article : dernier segment après /articles/ ou /read/. */
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

/** Signature et horodatage présents dans la page de l'article (attributs data-n-a-sg / -ts). */
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

/** URLs décodées, dans l'ordre des requêtes (null si une réponse est inexploitable). */
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
      // réponse inexploitable : on garde le lien Google
    }
  })
  return out
}

/**
 * Décode un lot de liens Google Actualités. Renvoie une table lien Google -> URL réelle
 * (seuls les liens décodés y figurent).
 */
export async function resolveGoogleNewsUrls(
  fetchFn: FetchLike,
  urls: ReadonlyArray<string>,
  maxBatch = 10,
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
        const p = parseDecodingParams(id, (await res.text()).slice(0, 400_000))
        if (p) params.push({ ...p, url })
      } catch {
        // page indisponible
      }
    }),
  )

  for (let i = 0; i < params.length; i += maxBatch) {
    const group = params.slice(i, i + maxBatch)
    try {
      const res = await fetchFn(BATCH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'user-agent': BROWSER_UA,
          origin: 'https://news.google.com',
          referer: 'https://news.google.com/',
        },
        body: buildBatchBody(group),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      parseBatchResponse(await res.text(), group.length).forEach((url, j) => {
        const source = group[j]
        if (url && source) resolved.set(source.url, url)
      })
    } catch {
      // service indisponible : liens Google conservés
    }
  }
  return resolved
}
