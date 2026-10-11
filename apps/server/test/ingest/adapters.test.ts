import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { IdentifierError } from '../../src/ingest/types.ts'
import { ADAPTERS } from '../../src/ingest/adapters/index.ts'
import { parseBlueskyFeed } from '../../src/ingest/adapters/bluesky.ts'
import { parseMyMapsKml } from '../../src/ingest/adapters/mymaps.ts'
import { parseFeed, stripHtml } from '../../src/ingest/adapters/rss.ts'
import { parseTelegramChannel } from '../../src/ingest/adapters/telegram.ts'
import { fetchText } from '../../src/ingest/http.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('telegram', () => {
  test('reads text messages with date and link', () => {
    const items = parseTelegramChannel(fixture('telegram.html'))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      externalId: 'mobilycee/101',
      url: 'https://t.me/mobilycee/101',
      text: 'Blocus en cours au lycée Victor-Hugo à Besançon\ndepuis 7h.',
    })
    expect(items[0]?.publishedAt.toISOString()).toBe('2026-10-05T07:12:00.000Z')
  })

  test('accepts the usual ways to write a channel', () => {
    const n = ADAPTERS.telegram.normalize
    for (const input of [
      '@MobiLycee',
      'mobilycee',
      'https://t.me/mobilycee',
      'https://t.me/s/MobiLycee/',
    ])
      expect(n(input)).toBe('mobilycee')
    expect(() => n('x')).toThrow(IdentifierError)
  })
})

describe('rss', () => {
  test('reads Google News and the publisher domain', () => {
    const items = parseFeed(fixture('googlenews.xml'))
    expect(items).toHaveLength(1)
    expect(items[0]?.publisherDomain).toBe('ouest-france.fr')
    expect(items[0]?.text).toContain('Mendès-France bloqué')
    expect(items[0]?.text.split('\n')).toHaveLength(2)
  })

  test('reads Atom', () => {
    expect(parseFeed(fixture('atom.xml'))).toEqual([
      expect.objectContaining({
        url: 'https://exemple.org/blocus-1',
        text: 'Point sur les blocus\nLe lycée Jean-Jaurès de Montreuil est bloqué.',
      }),
    ])
  })

  test('strips HTML', () => {
    expect(stripHtml('<p>a<br>b</p><script>x</script>')).toBe('a\nb')
  })

  test('feed URLs must be https', () => {
    expect(ADAPTERS.rss.normalize(' https://exemple.org/feed ')).toBe('https://exemple.org/feed')
    expect(() => ADAPTERS.rss.normalize('http://exemple.org/feed')).toThrow(IdentifierError)
    expect(() => ADAPTERS.rss.normalize('not a url')).toThrow(IdentifierError)
  })
})

describe('bluesky', () => {
  test('ignores reposts and builds the public link', () => {
    const items = parseBlueskyFeed(JSON.parse(fixture('bluesky.json')))
    expect(items).toHaveLength(1)
    expect(items[0]?.url).toBe('https://bsky.app/profile/syndicat.bsky.social/post/3kxyz')
  })

  test('an unexpected response is an error, not an empty list', () => {
    expect(() => parseBlueskyFeed({ nope: true })).toThrow(/Unexpected Bluesky/)
  })

  test('handles', () => {
    const n = ADAPTERS.bluesky.normalize
    expect(n('@Syndicat.Bsky.Social')).toBe('syndicat.bsky.social')
    expect(n('https://bsky.app/profile/syndicat.bsky.social')).toBe('syndicat.bsky.social')
    expect(() => n('not a handle')).toThrow(IdentifierError)
  })
})

describe('Google My Maps', () => {
  const kml = fixture('mymaps.kml')
  const now = new Date('2026-10-06T08:00:00Z')

  test('reads the points (folders included) with position and context', () => {
    const items = parseMyMapsKml(kml, 'MID123456789', now)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      geo: { lat: 50.6371, lng: 3.0612 },
      alwaysRelevant: true,
      url: 'https://www.google.com/maps/d/viewer?mid=MID123456789',
      externalId: 'MID123456789:Lycée Pasteur:50.6371,3.0612',
    })
    expect(items[0]?.text).toBe(
      'Carte « Plus de 35 lycées fermés dans le Nord et le Pas-de-Calais » / Lycées fermés le 2 octobre\nLycée Pasteur\nLille\nFermé toute la journée',
    )
    expect(items[1]?.geo).toEqual({ lat: 50.2912, lng: 2.7801 })
  })

  test('accepts points placed by address (no coordinates)', () => {
    const byAddress = parseMyMapsKml(kml, 'MID123456789', now)[2]
    expect(byAddress?.geo).toBeUndefined()
    expect(byAddress?.externalId).toBe(
      'MID123456789:Lycée Elisa LEMONNIER:Lycée Elisa LEMONNIER Douai Nord',
    )
  })

  test('accepts the map link or its id', () => {
    const mid = '143-XBuWkGffO5370dYlTSdy9Wvzk0ME'
    for (const input of [
      `https://www.google.com/maps/d/viewer?mid=${mid}&hl=en&ll=46.5,8.1&z=6`,
      `https://www.google.com/maps/d/u/0/embed?mid=${mid}`,
      mid,
    ])
      expect(ADAPTERS.mymaps.normalize(input)).toBe(mid)
    expect(() => ADAPTERS.mymaps.normalize('https://www.google.com/maps')).toThrow(IdentifierError)
  })
})

describe('adapters at work', () => {
  test('discover goes through the injected fetch', async () => {
    const asked: string[] = []
    const fetchFn = async (url: string) => {
      asked.push(url)
      return new Response(fixture('atom.xml'))
    }
    const items = await ADAPTERS.rss.discover(fetchFn, 'https://exemple.org/feed', new Date())
    expect(items).toHaveLength(1)
    expect(asked).toEqual(['https://exemple.org/feed'])
  })
})

describe('fetchText', () => {
  const noWait = { retryDelaysMs: [0, 0], sleep: async () => {} }

  test('retries after a 503 or a 429, not after a 404', async () => {
    const statuses = [503, 429, 200]
    let calls = 0
    const flaky = async () => {
      const status = statuses[calls++] ?? 200
      return new Response(status === 200 ? 'ok' : '', { status })
    }
    await expect(fetchText(flaky, 'https://news.google.com/rss/search?q=x', noWait)).resolves.toBe(
      'ok',
    )
    expect(calls).toBe(3)

    calls = 0
    const gone = async () => {
      calls++
      return new Response('', { status: 404 })
    }
    await expect(fetchText(gone, 'https://exemple.fr/rss', noWait)).rejects.toThrow('HTTP 404')
    expect(calls).toBe(1)
  })

  test('gives up after the retries', async () => {
    let calls = 0
    const down = async () => {
      calls++
      return new Response('', { status: 503 })
    }
    await expect(
      fetchText(down, 'https://news.google.com/rss', { retryDelaysMs: [0], sleep: async () => {} }),
    ).rejects.toThrow('HTTP 503')
    expect(calls).toBe(2)
  })

  test('decodes a page whose declared encoding is wrong', async () => {
    const latin1 = new Uint8Array([...'Lunéville'].map((c) => c.charCodeAt(0)))
    const res = async () =>
      new Response(latin1, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    await expect(fetchText(res, 'https://exemple.fr/x')).resolves.toBe('Lunéville')
  })
})
