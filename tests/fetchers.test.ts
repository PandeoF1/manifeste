import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTelegramChannel } from '@shared/fetchers/telegram.ts'
import { parseFeed, stripHtml } from '@shared/fetchers/rss.ts'
import { parseBlueskyFeed } from '@shared/fetchers/bluesky.ts'
import { fetchText } from '@shared/fetchers/types.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('telegram', () => {
  it('extrait les messages texte avec date et lien', () => {
    const items = parseTelegramChannel(fixture('telegram.html'))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      externalId: 'mobilycee/101',
      url: 'https://t.me/mobilycee/101',
      text: 'Blocus en cours au lycée Victor-Hugo à Besançon\ndepuis 7h.',
    })
    expect(items[0]?.publishedAt.toISOString()).toBe('2026-10-05T07:12:00.000Z')
  })
})

describe('rss', () => {
  it('parse Google Actualités et récupère le domaine éditeur', () => {
    const items = parseFeed(fixture('googlenews.xml'))
    expect(items).toHaveLength(1)
    expect(items[0]?.publisherDomain).toBe('ouest-france.fr')
    expect(items[0]?.text).toContain('Mendès-France bloqué')
    expect(items[0]?.text.split('\n')).toHaveLength(2)
  })

  it('parse Atom', () => {
    const items = parseFeed(fixture('atom.xml'))
    expect(items).toEqual([
      expect.objectContaining({
        url: 'https://exemple.org/blocus-1',
        text: 'Point sur les blocus\nLe lycée Jean-Jaurès de Montreuil est bloqué.',
      }),
    ])
  })

  it('nettoie le HTML', () => {
    expect(stripHtml('<p>a<br>b</p><script>x</script>')).toBe('a\nb')
  })
})

describe('bluesky', () => {
  it('ignore les reposts et construit le lien public', () => {
    const items = parseBlueskyFeed(JSON.parse(fixture('bluesky.json')))
    expect(items).toHaveLength(1)
    expect(items[0]?.url).toBe('https://bsky.app/profile/syndicat.bsky.social/post/3kxyz')
  })
})

describe('fetchText', () => {
  it('réessaie après un 503 ou un 429, pas après un 404', async () => {
    const statuses = [503, 429, 200]
    let calls = 0
    const flaky = async () => {
      const status = statuses[calls++] ?? 200
      return new Response(status === 200 ? 'ok' : '', { status })
    }
    await expect(
      fetchText(flaky, 'https://news.google.com/rss/search?q=x', 1000, [0, 0]),
    ).resolves.toBe('ok')
    expect(calls).toBe(3)

    calls = 0
    const gone = async () => {
      calls++
      return new Response('', { status: 404 })
    }
    await expect(fetchText(gone, 'https://exemple.fr/rss', 1000, [0, 0])).rejects.toThrow(
      'HTTP 404',
    )
    expect(calls).toBe(1)
  })

  it('abandonne après les nouvelles tentatives', async () => {
    let calls = 0
    const down = async () => {
      calls++
      return new Response('', { status: 503 })
    }
    await expect(fetchText(down, 'https://news.google.com/rss', 1000, [0])).rejects.toThrow(
      'HTTP 503',
    )
    expect(calls).toBe(2)
  })
})
