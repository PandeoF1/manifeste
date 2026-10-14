import type { SOURCE_KINDS } from '@manifeste/db'

export type SourceKind = (typeof SOURCE_KINDS)[number]

/** One thing a source published, as an adapter hands it to the pipeline. */
export interface ScrapedItem {
  /** Stable id inside the source (post id, feed guid…). */
  externalId: string
  /** Public https URL. */
  url: string
  /** What the source itself says: a post's text, a feed's title and summary. */
  text: string
  publishedAt: Date
  /** Publisher domain when it differs from the URL (aggregators such as Google News). */
  publisherDomain?: string
  /** Position of a map point, used to find the exact school. */
  geo?: { lat: number; lng: number }
  /** Sent to the AI without the keyword filter (a point of a map of blockades). */
  alwaysRelevant?: boolean
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** A kind of source: how to validate what an admin typed and how to read it. */
export interface SourceAdapter {
  readonly kind: SourceKind
  /** Human name for the admin. */
  readonly label: string
  /** The identifier in its canonical form, or an `IdentifierError` with a readable message. */
  normalize(input: string): string
  /** Reads the source. `now` is the reading time (maps have no dates). */
  discover(fetchFn: FetchLike, identifier: string, now: Date): Promise<ScrapedItem[]>
}

export class IdentifierError extends Error {}
