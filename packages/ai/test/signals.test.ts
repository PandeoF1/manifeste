import { describe, expect, test } from 'bun:test'
import { buildSignalsRequest, parseSignals } from '../src/index.ts'

const items = [
  {
    id: '0',
    publishedOn: '2026-10-17',
    text: 'À Lyon, plusieurs centaines de personnes se sont rassemblées place Bellecour ce samedi. Un autre rassemblement a eu lieu dans le 13e arrondissement de Paris.',
  },
]
const entry = (over: Record<string, unknown> = {}) => ({
  city: 'Lyon',
  day: '2026-10-17',
  timing: 'en_cours',
  title: 'Rassemblement contre la vie chère',
  lieu: {
    name: 'place Bellecour',
    niveau: 'lieu',
    quote: 'se sont rassemblées place Bellecour ce samedi',
  },
  ...over,
})
const wrap = (...m: unknown[]) => ({ articles: [{ item_id: '0', mobilisations: m }] })

describe('signaled mobilisations answers', () => {
  test('keeps an entry whose city and quote are in the text', () => {
    const [s] = parseSignals(wrap(entry()), items)
    expect(s).toMatchObject({
      city: 'Lyon',
      day: '2026-10-17',
      timing: 'ongoing',
      place: { name: 'place Bellecour', level: 'place' },
    })
  })

  test('a place that cannot be backed falls back to the city, never to an invented place', () => {
    const [s] = parseSignals(
      wrap(entry({ lieu: { name: 'rue Inventée', niveau: 'rue', quote: 'dans la rue Inventée' } })),
      items,
    )
    expect(s?.place).toEqual({ name: 'Lyon', level: 'city', quote: 'Lyon' })
  })

  test('a district stays a district when its quote is in the text', () => {
    const [s] = parseSignals(
      wrap(
        entry({
          city: 'Paris',
          lieu: {
            name: '13e arrondissement',
            niveau: 'arrondissement',
            quote: 'dans le 13e arrondissement de Paris',
          },
        }),
      ),
      items,
    )
    expect(s?.place.level).toBe('district')
  })

  test('drops a city that is not in the text, a duplicate city, an unknown level or timing', () => {
    expect(parseSignals(wrap(entry({ city: 'Marseille' })), items)).toEqual([])
    expect(parseSignals(wrap(entry(), entry()), items)).toHaveLength(1)
    expect(
      parseSignals(wrap(entry({ lieu: { name: 'x', niveau: 'planète', quote: 'x' } })), items),
    ).toEqual([])
    expect(parseSignals(wrap(entry({ timing: 'bientôt' })), items)).toEqual([])
  })

  test('an impossible date becomes unknown; a malformed answer gives nothing', () => {
    expect(parseSignals(wrap(entry({ day: '2026-02-31' })), items)[0]?.day).toBeNull()
    expect(parseSignals({ articles: 'x' }, items)).toEqual([])
    expect(parseSignals(null, items)).toEqual([])
    expect(parseSignals({ articles: [{ item_id: '9', mobilisations: [entry()] }] }, items)).toEqual(
      [],
    )
  })

  test('the request carries the publication date and caps the text', () => {
    const req = buildSignalsRequest([
      { id: '0', publishedOn: '2026-10-17', text: 'x'.repeat(20000) },
    ])
    expect(req.user).toContain('2026-10-17')
    expect(req.user.length).toBeLessThan(6300)
  })
})
