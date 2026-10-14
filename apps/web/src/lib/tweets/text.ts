// Tweet text: length as X counts it, hashtag handling and French formatting.

export const MAX_TWEET = 280
/** X shortens every link to 23 characters, whatever its length. */
export const URL_LENGTH = 23

const URL_RE = /https?:\/\/\S+/g

/** Length of a tweet as X counts it (links count 23). Emoji and accents count as the browser says. */
export function tweetLength(text: string): number {
  const withoutUrls = text.replace(URL_RE, '')
  const urls = (text.match(URL_RE) ?? []).length
  return [...withoutUrls].length + urls * URL_LENGTH
}

/** "#a b, #c" -> ["#a", "#b", "#c"]: spaces and commas separate, a missing # is added. */
export function parseHashtags(input: string): string[] {
  const tags = input
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .map((t) => `#${t}`)
  return [...new Set(tags)]
}

export interface Composition {
  text: string
  length: number
  /** Hashtags dropped because the tweet would be too long. */
  droppedTags: string[]
  tooLong: boolean
}

/**
 * Body, then the link, then hashtags. Hashtags are the first thing to go when the text is too
 * long (last one first); the body is never cut: the author must shorten it.
 */
export function compose(body: string, url: string, hashtags: ReadonlyArray<string>): Composition {
  const build = (tags: ReadonlyArray<string>) =>
    [body.trim(), url.trim(), tags.join(' ')].filter(Boolean).join('\n\n')
  const kept = [...hashtags]
  const droppedTags: string[] = []
  while (kept.length > 0 && tweetLength(build(kept)) > MAX_TWEET) {
    droppedTags.unshift(kept.pop() as string)
  }
  const text = build(kept)
  const length = tweetLength(text)
  return { text, length, droppedTags, tooLong: length > MAX_TWEET }
}

const nf = new Intl.NumberFormat('fr-FR')
/** 1234 -> "1 234" (with a narrow no-break space, which X displays fine). */
export const num = (n: number): string => nf.format(n)

const dayFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
/** AAAA-MM-JJ -> "14 septembre". */
export const dayLabel = (day: string): string => dayFmt.format(new Date(`${day}T00:00:00Z`))

export const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one)

/** Intent link: opens X with the text filled in (free, no API; the image is added by hand). */
export const intentUrl = (text: string): string =>
  `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
