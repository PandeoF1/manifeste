import { describe, expect, test } from 'bun:test'
import { batchResponse, gnPage } from './gn-fixtures.ts'
import {
  buildBatchBody,
  googleNewsArticleId,
  parseBatchResponse,
  parseDecodingParams,
  resolveGoogleNewsUrls,
} from '../../src/ingest/googlenews.ts'

const GN = 'https://news.google.com/rss/articles/CBMiAAA?oc=5'
describe('Google News link decoding', () => {
  test('reads the article id', () => {
    expect(googleNewsArticleId(GN)).toBe('CBMiAAA')
    expect(googleNewsArticleId('https://news.google.com/read/XYZ')).toBe('XYZ')
    expect(googleNewsArticleId('https://www.ouest-france.fr/a')).toBeNull()
  })

  test('reads signature and timestamp', () => {
    expect(parseDecodingParams('CBMiAAA', gnPage)).toEqual({
      id: 'CBMiAAA',
      signature: 'SIG_abc',
      timestamp: '1759680000',
    })
    expect(parseDecodingParams('X', '<html></html>')).toBeNull()
  })

  test('builds the batchexecute request', () => {
    const body = decodeURIComponent(
      buildBatchBody([{ id: 'CBMiAAA', signature: 'SIG_abc', timestamp: '1759680000' }]).slice(6),
    )
    expect(body).toContain('"Fbv4je"')
    expect(body).toContain('garturlreq')
    expect(body).toContain('\\"CBMiAAA\\",1759680000,\\"SIG_abc\\"')
  })

  test('reads the decoded URLs in order', () => {
    expect(parseBatchResponse(batchResponse(['https://a.fr/1', 'https://b.fr/2']), 2)).toEqual([
      'https://a.fr/1',
      'https://b.fr/2',
    ])
    expect(parseBatchResponse('garbage', 1)).toEqual([null])
  })

  test('matches each URL to the right article (one request per article)', async () => {
    const ids = ['AAA1', 'BBB2', 'CCC3']
    const fetchFn = async (url: string, init?: RequestInit) => {
      const id = ids.find((i) => url.endsWith(`/rss/articles/${i}`))
      if (id) return new Response(`<div data-n-a-ts="1759680000" data-n-a-sg="SIG_${id}"></div>`)
      if (url.includes('batchexecute')) {
        // Answers for the article asked, whatever the order of arrival.
        const body = decodeURIComponent(String(init?.body))
        const asked = ids.find((i) => body.includes(`SIG_${i}`))
        await new Promise((r) => setTimeout(r, asked === 'AAA1' ? 20 : 1))
        return new Response(batchResponse([`https://journal.fr/${asked}`]))
      }
      throw new Error(url)
    }
    const map = await resolveGoogleNewsUrls(
      fetchFn,
      ids.map((i) => `https://news.google.com/rss/articles/${i}`),
    )
    for (const i of ids)
      expect(map.get(`https://news.google.com/rss/articles/${i}`)).toBe(`https://journal.fr/${i}`)
  })

  test('decodes end to end, and keeps the Google link on failure', async () => {
    const fetchFn = async (url: string) => {
      if (url.startsWith('https://news.google.com/rss/articles/CBMiAAA'))
        return new Response(gnPage)
      if (url.startsWith('https://news.google.com/rss/articles/'))
        return new Response('', { status: 404 })
      if (url.includes('batchexecute'))
        return new Response(batchResponse(['https://www.ouest-france.fr/article-1']))
      throw new Error(url)
    }
    const map = await resolveGoogleNewsUrls(fetchFn, [
      GN,
      'https://news.google.com/rss/articles/AUTRE',
    ])
    expect([...map]).toEqual([[GN, 'https://www.ouest-france.fr/article-1']])
  })
})
