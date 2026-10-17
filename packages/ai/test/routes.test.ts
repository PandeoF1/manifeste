import { describe, expect, test } from 'bun:test'
import { buildRoutesRequest, parseRoutes } from '../src/index.ts'

const items = [
  {
    id: '0',
    publishedOn: '2026-10-16',
    text: 'Samedi 17 octobre à Montpellier, le cortège partira de la place de la Comédie à 14 h, passera par le boulevard du Jeu-de-Paume et rejoindra la gare Saint-Roch.',
  },
]
const march = (over: Record<string, unknown> = {}) => ({
  city: 'Montpellier',
  day: '2026-10-17',
  timing: 'annonce',
  title: 'Marche',
  places: [
    { name: 'place de la Comédie', quote: 'le cortège partira de la place de la Comédie à 14 h' },
    { name: 'gare Saint-Roch', quote: 'rejoindra la gare Saint-Roch' },
  ],
  ...over,
})
const wrap = (...marches: unknown[]) => ({ articles: [{ item_id: '0', marches }] })

describe('route detection answers', () => {
  test('keeps a march whose quotes are in the text', () => {
    const [m] = parseRoutes(wrap(march()), items)
    expect(m).toMatchObject({ city: 'Montpellier', day: '2026-10-17', timing: 'announced' })
    expect(m?.places.map((p) => p.name)).toEqual(['place de la Comédie', 'gare Saint-Roch'])
  })

  test('drops a place whose quote is invented, and a march left with one place', () => {
    const invented = march({
      places: [
        { name: 'place de la Comédie', quote: 'le cortège partira de la place de la Comédie' },
        { name: 'pont de Sète', quote: 'puis le pont de Sète' },
      ],
    })
    expect(parseRoutes(wrap(invented), items)).toEqual([])
  })

  test('drops a place whose name is not in its own quote', () => {
    const mismatch = march({
      places: [
        { name: 'place de la Comédie', quote: 'le cortège partira de la place de la Comédie' },
        { name: 'mairie', quote: 'rejoindra la gare Saint-Roch' },
      ],
    })
    expect(parseRoutes(wrap(mismatch), items)).toEqual([])
  })

  test('drops a march whose city is not in the text, an impossible date and an unknown timing', () => {
    expect(parseRoutes(wrap(march({ city: 'Lyon' })), items)).toEqual([])
    expect(parseRoutes(wrap(march({ timing: 'plus tard' })), items)).toEqual([])
    expect(parseRoutes(wrap(march({ day: '2026-02-31' })), items)[0]?.day).toBeNull()
  })

  test('ignores an answer for an article that was not sent, and a malformed answer', () => {
    expect(parseRoutes({ articles: [{ item_id: '9', marches: [march()] }] }, items)).toEqual([])
    expect(parseRoutes({ articles: 'x' }, items)).toEqual([])
    expect(parseRoutes(null, items)).toEqual([])
  })

  test('the request carries the publication date and caps the text', () => {
    const req = buildRoutesRequest([
      { id: '0', publishedOn: '2026-10-16', text: 'x'.repeat(20000) },
    ])
    expect(req.user.length).toBeLessThan(8300)
    expect(req.user).toContain('2026-10-16')
  })
})
