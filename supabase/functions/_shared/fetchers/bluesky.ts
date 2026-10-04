import { z } from 'zod'
import { fetchText, type FetchLike, type ScrapedItem } from './types.ts'

const feedSchema = z.object({
  feed: z.array(
    z.object({
      post: z.object({
        uri: z.string(),
        author: z.object({ handle: z.string() }),
        record: z.object({ text: z.string().optional(), createdAt: z.string() }).loose(),
      }),
      reason: z.unknown().optional(),
    }),
  ),
})

/** Parse la réponse de app.bsky.feed.getAuthorFeed. Les reposts sont ignorés. */
export function parseBlueskyFeed(json: unknown): ScrapedItem[] {
  const data = feedSchema.parse(json)
  const items: ScrapedItem[] = []
  for (const entry of data.feed) {
    if (entry.reason) continue
    const { uri, author, record } = entry.post
    const rkey = uri.split('/').pop()
    const publishedAt = new Date(record.createdAt)
    const text = (record.text ?? '').trim()
    if (!rkey || !text || Number.isNaN(publishedAt.getTime())) continue
    items.push({
      externalId: uri,
      url: `https://bsky.app/profile/${author.handle}/post/${rkey}`,
      text,
      publishedAt,
    })
  }
  return items
}

export async function fetchBluesky(fetchFn: FetchLike, handle: string): Promise<ScrapedItem[]> {
  const url =
    'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed' +
    `?actor=${encodeURIComponent(handle)}&limit=30&filter=posts_no_replies`
  return parseBlueskyFeed(JSON.parse(await fetchText(fetchFn, url)))
}
