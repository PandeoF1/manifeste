import { describe, expect, test } from 'bun:test'
import {
  cleanReadable,
  reconcilePublished,
  readItems,
  type ReadInput,
} from '../../src/ingest/reader.ts'
import { batchResponse, gnPage } from './gn-fixtures.ts'

const feedItem = (over: Partial<ReadInput> = {}): ReadInput => ({
  id: 'i1',
  kind: 'rss',
  url: 'https://www.press.fr/article-1',
  text: 'Lycée Pasteur bloqué à Lille',
  publishedAt: new Date('2026-10-08T07:00:00Z'),
  publisherDomain: null,
  ...over,
})

const paragraphs = Array.from(
  { length: 5 },
  (_, i) =>
    `<p>Les élèves du lycée Pasteur de Lille ont bloqué l'entrée ce matin, paragraphe ${i + 1}, pour protester.</p>`,
).join('')
const article = (title = 'Lycée Pasteur bloqué', head = '') =>
  `<html lang="fr"><head><title>${title}</title>${head}</head><body><article>${paragraphs}</article></body></html>`

const read = (items: ReadInput[], fetchFn: (url: string) => Promise<Response>, gateway = false) =>
  readItems(items, { fetchFn, gateway })

describe('reading a press item', () => {
  test('adds the article to the feed text, without repeating lines', async () => {
    const [out] = await read([feedItem()], async () => new Response(article()))
    expect(out?.strategy).not.toBe('feed')
    expect(out?.text.startsWith('Lycée Pasteur bloqué à Lille')).toBe(true)
    expect(out?.text).toContain('paragraphe 5')
    expect(out?.pageChars).toBeGreaterThan(300)
    expect(out?.blocked).toBeNull()
  })

  test('posts and map points are taken as they are, with no request', async () => {
    let calls = 0
    const outs = await read(
      [
        feedItem({ kind: 'telegram', url: 'https://t.me/c/1' }),
        feedItem({ id: 'i2', kind: 'mymaps' }),
      ],
      async () => {
        calls++
        return new Response('')
      },
    )
    expect(calls).toBe(0)
    expect(outs.map((o) => o.strategy)).toEqual(['feed', 'feed'])
  })

  test('decodes a Google News link and takes the publisher domain from the real URL', async () => {
    const gn = 'https://news.google.com/rss/articles/CBMiAAA?oc=5'
    const fetchFn = async (url: string) => {
      if (url.startsWith('https://news.google.com/rss/articles/')) return new Response(gnPage)
      if (url.includes('batchexecute'))
        return new Response(batchResponse(['https://www.ouest-france.fr/a?utm_source=x']))
      if (url.startsWith('https://www.ouest-france.fr/a')) return new Response(article())
      throw new Error(url)
    }
    const [out] = await read([feedItem({ url: gn })], fetchFn)
    expect(out?.url).toBe('https://www.ouest-france.fr/a')
    expect(out?.publisherDomain).toBe('ouest-france.fr')
    expect(out?.text).toContain('paragraphe 3')
  })

  test('an undecodable Google link stays a Google link and is not fetched', async () => {
    const gn = 'https://news.google.com/rss/articles/NOPE'
    const asked: string[] = []
    const [out] = await read([feedItem({ url: gn })], async (url) => {
      asked.push(url)
      return new Response('', { status: 404 })
    })
    expect(out?.url).toBe(gn)
    expect(out?.strategy).toBe('feed')
    expect(asked.every((u) => u.includes('news.google.com'))).toBe(true)
  })

  test('takes the page date when the feed gives the re-indexing date; a live blog keeps the feed date', async () => {
    const dated = (title: string) =>
      article(title, '<meta property="article:published_time" content="2026-10-08T09:30:00+00:00">')
    const run = async (title: string) => {
      const [out] = await read(
        [feedItem({ publishedAt: new Date('2026-10-09T04:27:00Z') })],
        async () => new Response(dated(title)),
      )
      return out?.publishedAt.toISOString()
    }
    expect(await run('Mobilisation lycéenne à Lyon')).toBe('2026-10-08T09:30:00.000Z')
    expect(await run('DIRECT - Mobilisation lycéenne à Lyon')).toBe('2026-10-09T04:27:00.000Z')
  })
})

describe('pages that cannot be read', () => {
  test('a bot wall keeps the feed text and says why', async () => {
    const wall = `<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>`
    const [out] = await read([feedItem()], async () => new Response(wall))
    expect(out?.blocked?.reason).toBe('bot-wall')
    expect(out?.text).toBe('Lycée Pasteur bloqué à Lille')
    expect(out?.pageChars).toBe(0)
  })

  test('a paywall still gives the start of the article', async () => {
    const html = article(
      'Titre',
      '<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>',
    )
    const [out] = await read([feedItem()], async () => new Response(html))
    expect(out?.blocked?.reason).toBe('paywall')
    expect(out?.text).toContain('paragraphe 2')
  })

  test('an HTTP error is reported, the feed text is kept', async () => {
    const [out] = await read([feedItem()], async () => new Response('', { status: 403 }))
    expect(out?.pageError).toBe('HTTP 403')
    expect(out?.text).toBe('Lycée Pasteur bloqué à Lille')
  })

  test('the reading gateway is the last resort, for bare titles only, and only when allowed', async () => {
    const readable = Array.from(
      { length: 12 },
      (_, i) => `Les élèves du lycée Pasteur de Lille bloquent l'entrée, ligne ${i}.`,
    ).join('\n')
    const fetchFn = async (url: string) =>
      url.startsWith('https://r.jina.ai/')
        ? new Response(readable)
        : new Response('', { status: 403 })
    const [off] = await read([feedItem()], fetchFn, false)
    expect(off?.strategy).toBe('feed')
    const [on] = await read([feedItem()], fetchFn, true)
    expect(on?.strategy).toBe('gateway')
    expect(on?.text).toContain('ligne 11')
    const longFeed = feedItem({ text: 'x'.repeat(500) })
    expect((await read([longFeed], fetchFn, true))[0]?.strategy).toBe('feed')
  })
})

describe('helpers', () => {
  test('reconcilePublished', () => {
    const feed = new Date('2026-10-09T04:00:00Z')
    expect(reconcilePublished(feed, { publishedAt: null, title: '' })).toBe(feed)
    const page = new Date('2026-10-08T09:00:00Z')
    expect(reconcilePublished(feed, { publishedAt: page, title: 'x' })).toBe(page)
    // Less than 6 h older, or more than 5 days older: the feed date stays.
    expect(
      reconcilePublished(feed, { publishedAt: new Date('2026-10-09T01:00:00Z'), title: 'x' }),
    ).toBe(feed)
    expect(
      reconcilePublished(feed, { publishedAt: new Date('2026-09-01T00:00:00Z'), title: 'x' }),
    ).toBe(feed)
  })

  test('cleanReadable keeps paragraphs and drops banners', () => {
    const para = 'Les élèves du lycée ont bloqué l’entrée de l’établissement ce matin à Lille.'
    expect(
      cleanReadable(
        `Menu\n${para}\nNous utilisons des cookies pour améliorer votre expérience sur le site\n${para}`,
      ),
    ).toBe(`${para}\n${para}`)
  })
})
