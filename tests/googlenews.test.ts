import { describe, expect, it } from 'vitest'
import {
  buildBatchBody,
  googleNewsArticleId,
  parseBatchResponse,
  parseDecodingParams,
  resolveGoogleNewsUrls,
} from '@shared/fetchers/googlenews.ts'
import { enrichItems } from '@shared/enrich.ts'

const GN = 'https://news.google.com/rss/articles/CBMiAAA?oc=5'
const page =
  '<c-wiz><div jscontroller="x" data-n-a-id="CBMiAAA" data-n-a-ts="1759680000" data-n-a-sg="SIG_abc"></div></c-wiz>'
const batchResponse = (urls: string[]) =>
  `)]}'\n\n${JSON.stringify([
    ...urls.map((u) => [
      'wrb.fr',
      'Fbv4je',
      JSON.stringify(['garturlres', u, 1]),
      null,
      null,
      null,
      'generic',
    ]),
    ['di', 42],
    ['af.httprm', 41, '-1', 7],
  ])}`

describe('Google Actualités', () => {
  it("lit l'identifiant de l'article", () => {
    expect(googleNewsArticleId(GN)).toBe('CBMiAAA')
    expect(googleNewsArticleId('https://news.google.com/read/XYZ')).toBe('XYZ')
    expect(googleNewsArticleId('https://www.ouest-france.fr/a')).toBeNull()
  })

  it('lit signature et horodatage', () => {
    expect(parseDecodingParams('CBMiAAA', page)).toEqual({
      id: 'CBMiAAA',
      signature: 'SIG_abc',
      timestamp: '1759680000',
    })
    expect(parseDecodingParams('X', '<html></html>')).toBeNull()
  })

  it('construit la requête batchexecute', () => {
    const body = decodeURIComponent(
      buildBatchBody([{ id: 'CBMiAAA', signature: 'SIG_abc', timestamp: '1759680000' }]).slice(6),
    )
    expect(body).toContain('"Fbv4je"')
    expect(body).toContain('garturlreq')
    expect(body).toContain('\\"CBMiAAA\\",1759680000,\\"SIG_abc\\"')
  })

  it('lit les URLs décodées dans l’ordre', () => {
    expect(parseBatchResponse(batchResponse(['https://a.fr/1', 'https://b.fr/2']), 2)).toEqual([
      'https://a.fr/1',
      'https://b.fr/2',
    ])
    expect(parseBatchResponse('garbage', 1)).toEqual([null])
  })

  it('associe chaque URL au bon article (une requête par article)', async () => {
    const ids = ['AAA1', 'BBB2', 'CCC3']
    const pageFor = (id: string) => `<div data-n-a-ts="1759680000" data-n-a-sg="SIG_${id}"></div>`
    const fetchFn = async (url: string, init?: RequestInit) => {
      const id = ids.find((i) => url.endsWith(`/rss/articles/${i}`))
      if (id) return new Response(pageFor(id))
      if (url.includes('batchexecute')) {
        // Répond selon l'article demandé, quel que soit l'ordre d'arrivée.
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

  it('décode de bout en bout, et garde le lien Google en cas d’échec', async () => {
    const fetchFn = async (url: string) => {
      if (url.startsWith('https://news.google.com/rss/articles/CBMiAAA')) return new Response(page)
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

  it("enrichit un titre seul avec l'URL réelle et le chapeau de l'article", async () => {
    const article = `<meta property="og:description" content="Le lycée agricole de Saint-Aubin-du-Cormier (Ille-et-Vilaine) est bloqué depuis lundi.">`
    const fetchFn = async (url: string) => {
      if (url.startsWith('https://news.google.com/rss/articles/')) return new Response(page)
      if (url.includes('batchexecute'))
        return new Response(batchResponse(['https://www.ouest-france.fr/article-1']))
      if (url === 'https://www.ouest-france.fr/article-1') return new Response(article)
      throw new Error(url)
    }
    const [item] = await enrichItems(fetchFn, [
      {
        externalId: 'g1',
        url: GN,
        text: 'Des profs bloquent un lycée agricole en Ille-et-Vilaine - Ouest-France',
        publishedAt: new Date('2026-10-05T15:05:00Z'),
        publisherDomain: 'ouest-france.fr',
      },
    ])
    expect(item?.url).toBe('https://www.ouest-france.fr/article-1')
    expect(item?.text).toContain('Saint-Aubin-du-Cormier')
    expect(item?.publisherDomain).toBe('ouest-france.fr')
  })
})
