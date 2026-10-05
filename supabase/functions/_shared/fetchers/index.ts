import type { ScrapeKind } from '../sources.ts'
import { fetchBluesky } from './bluesky.ts'
import { fetchMyMaps } from './mymaps.ts'
import { fetchRss } from './rss.ts'
import { fetchTelegram } from './telegram.ts'
import type { FetchLike, ScrapedItem } from './types.ts'

export type { ScrapedItem, FetchLike } from './types.ts'

export function fetchSource(
  fetchFn: FetchLike,
  kind: ScrapeKind,
  identifier: string,
): Promise<ScrapedItem[]> {
  switch (kind) {
    case 'telegram':
      return fetchTelegram(fetchFn, identifier)
    case 'rss':
      return fetchRss(fetchFn, identifier)
    case 'bluesky':
      return fetchBluesky(fetchFn, identifier)
    case 'mymaps':
      return fetchMyMaps(fetchFn, identifier)
  }
}
