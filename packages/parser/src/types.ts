/** One block of article text, in reading order. */
export interface Block {
  kind: 'paragraph' | 'heading' | 'list-item' | 'quote'
  text: string
}

/** Where a publication date was read from, most reliable first. */
export type DateSource = 'json-ld' | 'meta' | 'time-element' | 'visible-text'

/** Why a page cannot be trusted as an article. */
export type BlockedReason =
  | 'bot-wall' // a challenge page (Cloudflare, DataDome…): nothing of the article was served
  | 'captcha'
  | 'access-denied' // 403 / "accès refusé" page
  | 'consent-wall' // a cookie or consent page instead of the article
  | 'not-found' // a 404 served with a 200 status
  | 'empty' // no readable text at all (client-side rendered, or truncated)
  | 'paywall' // the article is cut short: text is what the site shows non-subscribers

export interface Blocked {
  reason: BlockedReason
  /** What gave it away (a title, a marker), for debugging and the benchmark. */
  evidence: string
}

export type Strategy = 'json-ld' | 'site-rule' | 'article' | 'scored' | 'body' | 'none'

export interface ParsedPage {
  url: string
  title: string
  description: string
  siteName: string
  lang: string
  /** The article text, one block per line. */
  text: string
  blocks: Block[]
  publishedAt: Date | null
  publishedSource: DateSource | null
  modifiedAt: Date | null
  /** How the text was found, for debugging and the benchmark. */
  strategy: Strategy
  /** null when the page looks like a normal, readable article. */
  blocked: Blocked | null
}
