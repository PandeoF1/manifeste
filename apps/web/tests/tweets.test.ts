import { describe, expect, it } from 'bun:test'
import { cardSpec } from '../src/lib/tweets/card-spec'
import { daysOf, figuresFor, shiftDay, type TweetData } from '../src/lib/tweets/figures'
import { TEMPLATES, headline, templateById } from '../src/lib/tweets/templates'
import { MAX_TWEET, compose, parseHashtags, tweetLength } from '../src/lib/tweets/text'
import { niceAxis } from '../src/lib/tweets/card'
import type { Jour, Resume, Zone } from '../src/queries/donnees'

const day = (jour: string, etablissements: number, extra: Partial<Jour> = {}): Jour => ({
  jour,
  etablissements,
  bloques: etablissements,
  filtrants: 0,
  leves: 0,
  departements: Math.ceil(etablissements / 3),
  lycees: etablissements,
  facs: 0,
  signalements: etablissements * 2,
  via_presse: 0,
  via_organisations: 0,
  via_autres_sources: 0,
  via_signalements_sur_place: 0,
  ...extra,
})

const resume: Resume = {
  genere_le: '2026-10-14T10:00:00Z',
  premier_jour: '2026-09-14',
  dernier_jour: '2026-10-14',
  signalements: 200,
  etablissements: 120,
  departements: 40,
  facs: 12,
  sites_sources: 30,
  pic: { jour: '2026-10-06', etablissements: 50, departements: 20 },
  en_ce_moment: { bloques: 7, filtrants: 3 },
  origines: [
    { origine: 'presse', signalements: 150, etablissements: 100 },
    { origine: 'utilisateur', signalements: 50, etablissements: 40 },
  ],
}
const zones: Zone[] = [
  { zone: '75', etablissements: 30 },
  { zone: '69', etablissements: 12 },
  { zone: '13', etablissements: 20 },
].map((z) => ({
  ...z,
  lycees: z.etablissements,
  facs: 0,
  premier_jour: null,
  dernier_jour: null,
  signalements: z.etablissements,
  bloques_maintenant: 0,
  filtrants_maintenant: 0,
}))
const data: TweetData = {
  resume,
  jours: [day('2026-10-14', 8), day('2026-10-06', 50), day('2026-09-14', 2), day('2026-10-10', 10)],
  departements: zones,
  today: '2026-10-14',
}

describe('ranges', () => {
  it('shiftDay crosses months', () => {
    expect(shiftDay('2026-10-02', -6)).toBe('2026-09-26')
  })
  it('today keeps only today', () => {
    expect(daysOf(data.jours, 'today', data.today).map((j) => j.jour)).toEqual(['2026-10-14'])
  })
  it('7 days is today and the six days before', () => {
    expect(daysOf(data.jours, '7d', data.today).map((j) => j.jour)).toEqual([
      '2026-10-10',
      '2026-10-14',
    ])
  })
  it('all is sorted oldest first', () => {
    expect(daysOf(data.jours, 'all', data.today).map((j) => j.jour)[0]).toBe('2026-09-14')
  })
})

describe('figures', () => {
  it('all: distinct total from the summary', () => {
    const f = figuresFor(data, 'all')
    expect(f.schools).toBe(120)
    expect(f.schoolsIsPeak).toBe(false)
    expect(f.peak).toEqual({ jour: '2026-10-06', etablissements: 50 })
  })
  it('a short range gives the peak of one day, not a sum of days', () => {
    const f = figuresFor(data, '7d')
    expect(f.schools).toBe(10)
    expect(f.schoolsIsPeak).toBe(true)
    expect(f.reports).toBe(36)
  })
  it('today draws a two-week curve with today inside', () => {
    const f = figuresFor(data, 'today')
    expect(f.days).toHaveLength(1)
    expect(f.curve.map((j) => j.jour)).toEqual(['2026-10-06', '2026-10-10', '2026-10-14'])
  })
  it('an empty range does not crash', () => {
    const f = figuresFor({ ...data, jours: [] }, '30d')
    expect(f.schools).toBe(0)
    expect(f.peak).toBeNull()
    expect(headline(f)).toContain('Aucun signalement')
  })
})

describe('templates', () => {
  it('every template produces a text for every range', () => {
    for (const t of TEMPLATES) {
      for (const r of ['today', '7d', '30d', 'all'] as const) {
        const f = figuresFor(data, r)
        expect(t.body({ data, figures: f }).length).toBeGreaterThan(10)
        expect(cardSpec(t, data, f).title.length).toBeGreaterThan(0)
      }
    }
  })
  it('the headline says "pic" for a short range, never a fake total', () => {
    expect(headline(figuresFor(data, '7d'))).toContain('Pic de 10')
    expect(headline(figuresFor(data, 'all'))).toContain('120 établissements signalés')
  })
  it('departments template names the top three', () => {
    const f = figuresFor(data, 'all')
    const body = templateById('departements').body({ data, figures: f })
    expect(body.indexOf('(30)')).toBeLessThan(body.indexOf('(20)'))
  })
  it('sources template shares the press part', () => {
    const f = figuresFor(data, 'all')
    expect(templateById('sources').body({ data, figures: f })).toContain('75 %')
  })
})

describe('tweet text', () => {
  it('links count 23 whatever their length', () => {
    expect(tweetLength('a https://manifeste.pandeo.fr/une/tres/longue/adresse/xxxxxxxx')).toBe(
      2 + 23,
    )
  })
  it('parses hashtags: separators, missing #, duplicates, punctuation', () => {
    expect(parseHashtags('#lycées, mobilisation  #lycées #a-b')).toEqual([
      '#lycées',
      '#mobilisation',
      '#ab',
    ])
  })
  it('drops hashtags (last first) before the tweet is too long, never the body', () => {
    const body = 'x'.repeat(240)
    const c = compose(body, 'https://x.fr', ['#un', '#deux', '#trois'])
    expect(c.length).toBeLessThanOrEqual(MAX_TWEET)
    expect(c.droppedTags[c.droppedTags.length - 1]).toBe('#trois')
    expect(c.text.startsWith(body)).toBe(true)
  })
  it('flags a body that is too long on its own', () => {
    expect(compose('x'.repeat(300), '', []).tooLong).toBe(true)
  })
})

describe('niceAxis', () => {
  it('uses whole-number steps and covers the maximum', () => {
    expect(niceAxis(8)).toEqual({ step: 2, max: 8 })
    expect(niceAxis(70)).toEqual({ step: 20, max: 80 })
    expect(niceAxis(42)).toEqual({ step: 20, max: 60 })
    expect(niceAxis(1)).toEqual({ step: 1, max: 1 })
  })
})

describe('local reset', () => {
  it('?reset is detected and removed from the address', async () => {
    const { wantsReset, withoutReset } = await import('../src/lib/resetLocal')
    expect(wantsReset('?reset')).toBe(true)
    expect(wantsReset('?reset=1&lat=1')).toBe(true)
    expect(wantsReset('?lat=1')).toBe(false)
    expect(withoutReset('https://manifeste.pandeo.fr/?reset=1&lat=46.4&lng=2.4#x')).toBe(
      '/?lat=46.4&lng=2.4#x',
    )
  })
})
