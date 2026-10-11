import { describe, expect, it } from 'bun:test'
import {
  aggregate,
  badgesFor,
  fromApiMedia,
  outletOf,
  topDemands,
  type MediaRow,
} from '@/lib/mediaStats'

const row = (domain: string, over: Partial<MediaRow> = {}): MediaRow => ({
  url: `https://${domain}/${Math.random()}`,
  domain,
  title: null,
  published_at: null,
  about_movement: true,
  mentions_demands: false,
  demands: [],
  voices: [],
  focus: 'mobilisation',
  incidents: false,
  police_violence: false,
  terms: [],
  tone: 'neutre',
  quote_demands: null,
  quote_framing: null,
  ...over,
})

describe('statistics per outlet', () => {
  it('groups by outlet and by owner, excluding unrelated articles', () => {
    const cn = (over: Partial<MediaRow> = {}) =>
      row('cnews.fr', {
        focus: 'incidents',
        voices: ['police_prefecture'],
        tone: 'defavorable',
        terms: ['casseurs'],
        ...over,
      })
    const rows = [
      row('www.cnews.fr', {
        focus: 'incidents',
        voices: ['police_prefecture'],
        tone: 'defavorable',
        terms: ['casseurs'],
      }),
      ...Array.from({ length: 16 }, () => cn()),
      row('europe1.fr', { about_movement: false }),
      row('humanite.fr', {
        mentions_demands: true,
        voices: ['lyceens'],
        demands: ['Réforme du bac'],
      }),
    ]
    const byOutlet = aggregate(rows, 'outlet')
    const cnews = byOutlet.find((o) => o.key === 'cnews.fr')
    expect(cnews?.articles).toBe(17)
    expect(cnews?.terms[0]).toEqual(['casseurs', 17])
    expect(cnews?.badges.map((b) => b.id)).toEqual(['degats', 'officiel'])
    expect(byOutlet.some((o) => o.key === 'europe1.fr')).toBe(false)
    const owners = aggregate(rows, 'owner')
    expect(owners[0]?.name).toBe('Groupe Canal+ (Bolloré)')
    expect(cnews?.badges[0]?.rule).toContain('Sur 17 articles')
    expect(topDemands(rows)).toEqual([['réforme du bac', 1]])
  })

  it('demands are measured on articles where the AI read more than a title', () => {
    const rows = [
      ...Array.from({ length: 16 }, () =>
        row('lefigaro.fr', { focus: 'incidents', text_chars: 90 }),
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        row('lemonde.fr', { mentions_demands: i < 12, text_chars: i < 12 ? 600 : null }),
      ),
    ]
    const stats = aggregate(rows, 'outlet')
    const figaro = stats.find((s) => s.key === 'lefigaro.fr')
    expect(figaro?.demandsBase).toBe(0)
    // Titles only: no "few demands" finding, for lack of measurement.
    expect(figaro?.badges.map((b) => b.id)).not.toContain('degats')
    const monde = stats.find((s) => s.key === 'lemonde.fr')
    expect(monde?.demandsBase).toBe(15)
    expect(monde?.demands).toBeCloseTo(0.8)
    expect(monde?.badges.map((b) => b.id)).toContain('revendications')
  })

  it('no finding below 3 articles, and an unknown domain is shown as is', () => {
    expect(
      badgesFor({
        name: 'x',
        owner: 'y',
        articles: 14,
        demands: 0,
        demandsBase: 14,
        studentVoices: 0,
        officialVoices: 1,
        incidentsFocus: 1,
        incidents: 1,
        policeViolence: 0,
        favorable: 0,
        defavorable: 1,
        terms: [],
      }),
    ).toEqual([])
    expect(outletOf('exemple.org')).toEqual({ name: 'exemple.org', owner: 'Non renseigné' })
  })
})

describe('CSV export', () => {
  it('escapes quotes and separators, with a BOM for Excel', async () => {
    const { mediaCsv } = await import('@/lib/mediaExport')
    const stats = aggregate(
      [
        row('cnews.fr', { focus: 'incidents', terms: ['casseurs'], tone: 'defavorable' }),
        row('cnews.fr', { focus: 'incidents' }),
        row('cnews.fr', { focus: 'incidents' }),
      ],
      'outlet',
    )
    const csv = mediaCsv(stats, 'outlet')
    expect(csv.startsWith('﻿Média;Propriétaire;Articles;')).toBe(true)
    expect(csv).toContain('CNews;Groupe Canal+ (Bolloré);3;0;0;0;100;0;0;33;')
    expect(csv).toContain('casseurs (1)')
  })
})

describe('owners', () => {
  it("recognises public broadcasting and a group's regional sites", () => {
    expect(outletOf('ici.fr').owner).toBe('Service public')
    expect(outletOf('france3-regions.franceinfo.fr').name).toBe('France 3 Régions')
    expect(outletOf('la1ere.franceinfo.fr').owner).toBe('Service public')
    expect(outletOf('www.lorient.maville.com').owner).toBe('Groupe Sipa Ouest-France')
    expect(outletOf('www.ouest-france.fr').owner).toBe('Groupe Sipa Ouest-France')
    expect(outletOf('hitwest.ouest-france.fr').owner).toBe('Groupe 1981')
    expect(outletOf('exemple.org').owner).toBe('Non renseigné')
  })

  it('puts unknown owners last', () => {
    const rows = [...Array.from({ length: 5 }, () => row('inconnu.org')), row('cnews.fr')]
    expect(aggregate(rows, 'owner').map((o) => o.name)).toEqual([
      'Groupe Canal+ (Bolloré)',
      'Non renseigné',
    ])
  })
})

describe('reading the API', () => {
  it('translates the English values back to the vocabulary of the statistics', () => {
    const r = fromApiMedia({
      url: 'https://x.fr/a',
      domain: 'x.fr',
      title: 'T',
      publishedAt: new Date('2026-10-06T08:00:00Z'),
      aboutMovement: true,
      mentionsDemands: true,
      demands: ['bac'],
      voices: ['students', 'police_prefecture', 'other'],
      focus: 'demands',
      incidents: false,
      policeViolence: true,
      terms: ['élèves'],
      tone: 'unfavourable',
      quoteDemands: null,
      quoteFraming: 'q',
      textChars: 900,
    })
    expect(r).toMatchObject({
      published_at: '2026-10-06T08:00:00.000Z',
      voices: ['lyceens', 'police_prefecture', 'other'],
      focus: 'revendications',
      tone: 'defavorable',
      police_violence: true,
      text_chars: 900,
    })
  })
})
