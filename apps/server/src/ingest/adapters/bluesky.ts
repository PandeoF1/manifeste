import { Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { fetchText } from '../http.ts'
import { IdentifierError, type ScrapedItem, type SourceAdapter } from '../types.ts'

const feedSchema = t.Object({
  feed: t.Array(
    t.Object({
      post: t.Object({
        uri: t.String(),
        author: t.Object({ handle: t.String() }),
        record: t.Object({ text: t.Optional(t.String()), createdAt: t.String() }),
      }),
      reason: t.Optional(t.Unknown()),
    }),
  ),
})

/** Parses `app.bsky.feed.getAuthorFeed`. Reposts are ignored. */
export function parseBlueskyFeed(json: unknown): ScrapedItem[] {
  if (!Value.Check(feedSchema, json)) throw new Error('Unexpected Bluesky response')
  const items: ScrapedItem[] = []
  for (const entry of json.feed) {
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

export const blueskyAdapter: SourceAdapter = {
  kind: 'bluesky',
  label: 'Bluesky account',
  normalize(input) {
    const raw = input.trim()
    // "@handle", "handle", "https://bsky.app/profile/handle"
    const m = raw.match(/^(?:https?:\/\/)?bsky\.app\/profile\/([^/?#]+)/)
    const handle = (m?.[1] ?? raw).replace(/^@/, '').toLowerCase()
    if (!/^(did:plc:[a-z0-9]+|[a-z0-9-]+(\.[a-z0-9-]+)+)$/.test(handle))
      throw new IdentifierError('Invalid Bluesky handle (e.g. union.bsky.social).')
    return handle
  },
  async discover(fetchFn, identifier) {
    const url =
      'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed' +
      `?actor=${encodeURIComponent(identifier)}&limit=30&filter=posts_no_replies`
    return parseBlueskyFeed(JSON.parse(await fetchText(fetchFn, url)))
  },
}
