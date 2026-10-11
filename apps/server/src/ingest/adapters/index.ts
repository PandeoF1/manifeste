import type { SourceAdapter, SourceKind } from '../types.ts'
import { blueskyAdapter } from './bluesky.ts'
import { myMapsAdapter } from './mymaps.ts'
import { rssAdapter } from './rss.ts'
import { telegramAdapter } from './telegram.ts'

/** One adapter per source kind: adding a kind is one file here and a value in the `source_kind` enum. */
export const ADAPTERS: Record<SourceKind, SourceAdapter> = {
  rss: rssAdapter,
  telegram: telegramAdapter,
  bluesky: blueskyAdapter,
  mymaps: myMapsAdapter,
}
