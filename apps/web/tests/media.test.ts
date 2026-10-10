import { describe, expect, it } from 'bun:test'
import { articleTitle, isPressItem, parseMediaAnalyses } from '@shared/media.ts'
import { aggregate, badgesFor, outletOf, topDemands, type MediaRow } from '@/lib/mediaStats'

const item = (text: string, url = 'https://www.lefigaro.fr/a') => ({
  externalId: url,
  url,
  text,
  publishedAt: new Date('2026-10-06T08:00:00Z'),
})

describe('analyse des médias', () => {
  const batch = [
    {
      id: '0',
      item: item('Blocus au lycée. « Nous refusons la réforme du bac » expliquent les élèves.'),
    },
  ]
  const answer = {
    item_id: '0',
    about_movement: true,
    mentions_demands: true,
    demands: ['réforme du bac'],
    voices: ['lyceens', 'inconnu'],
    focus: 'revendications',
    incidents: false,
    police_violence: false,
    terms: ['élèves'],
    tone: 'neutre',
    quote_demands: '"Nous refusons la réforme du bac"',
    quote_framing: 'Une phrase inventée par le modèle',
  }

  it('garde les citations réellement présentes dans le texte, retire les inventées', () => {
    const [a] = parseMediaAnalyses({ articles: [answer] }, batch)
    expect(a?.quote_demands).toBe('"Nous refusons la réforme du bac"')
    expect(a?.quote_framing).toBeNull()
    // Une valeur hors liste vide la liste (catch) plutôt que de rejeter l'article.
    expect(a?.voices).toEqual([])
  })

  it('ignore les identifiants inconnus et les sorties invalides', () => {
    expect(parseMediaAnalyses({ articles: [{ ...answer, item_id: '9' }] }, batch)).toEqual([])
    expect(parseMediaAnalyses({ articles: [{ ...answer, focus: 'autre' }] }, batch)).toEqual([])
    expect(parseMediaAnalyses(null, batch)).toEqual([])
  })

  it('ne retient que la presse', () => {
    expect(isPressItem('rss', item('x'))).toBe(true)
    expect(isPressItem('telegram', item('x', 'https://t.me/s/canal/1'))).toBe(false)
    expect(isPressItem('rss', { ...item('x', 'https://news.google.com/rss/articles/x') })).toBe(
      false,
    )
    expect(
      isPressItem('rss', {
        ...item('x', 'https://news.google.com/rss/articles/x'),
        publisherDomain: 'cnews.fr',
      }),
    ).toBe(true)
  })
})

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

describe('titre de l’article', () => {
  it('prend la première ligne non vide (texte enrichi sans titre de flux)', () => {
    expect(articleTitle(item('\nBlocus à Lens\nLe chapeau de l’article'))).toBe('Blocus à Lens')
    expect(articleTitle(item('Titre du flux\nChapeau'))).toBe('Titre du flux')
    expect(articleTitle(item(''))).toBe('')
  })
})

describe('statistiques par média', () => {
  it('regroupe par média et par propriétaire, hors articles sans rapport', () => {
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

  it('les revendications se mesurent sur les articles dont l’IA a lu plus qu’un titre', () => {
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
    // Titres seuls : pas de constat « peu de revendications », faute de mesure.
    expect(figaro?.badges.map((b) => b.id)).not.toContain('degats')
    const monde = stats.find((s) => s.key === 'lemonde.fr')
    expect(monde?.demandsBase).toBe(15)
    expect(monde?.demands).toBeCloseTo(0.8)
    expect(monde?.badges.map((b) => b.id)).toContain('revendications')
  })

  it('pas de constat en dessous de 3 articles, et domaine inconnu affiché tel quel', () => {
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

describe('lignes enregistrées', () => {
  it('relie chaque analyse à son article et ignore les identifiants inconnus', async () => {
    const { mediaRows } = await import('@shared/media.ts')
    const b = [
      {
        id: '0',
        item: item('Titre de l’article\nChapeau', 'https://www.lemonde.fr/a'),
        source: { id: 's1' },
      },
    ]
    const base = {
      about_movement: true,
      mentions_demands: false,
      demands: [],
      voices: [],
      focus: 'mobilisation' as const,
      incidents: false,
      police_violence: false,
      terms: [],
      tone: 'neutre' as const,
      quote_demands: null,
      quote_framing: null,
    }
    const rows = mediaRows(
      [
        { ...base, item_id: '0' },
        { ...base, item_id: '7' },
      ],
      b,
      'm',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      url: 'https://www.lemonde.fr/a',
      domain: 'lemonde.fr',
      title: 'Titre de l’article',
      source_id: 's1',
      model: 'm',
    })
    expect(rows[0]).not.toHaveProperty('item_id')
  })
})

describe('export CSV', () => {
  it('échappe les guillemets et séparateurs, avec BOM pour Excel', async () => {
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

describe('propriétaires', () => {
  it('reconnaît le service public et les sites régionaux d’un groupe', () => {
    expect(outletOf('ici.fr').owner).toBe('Service public')
    expect(outletOf('france3-regions.franceinfo.fr').name).toBe('France 3 Régions')
    expect(outletOf('la1ere.franceinfo.fr').owner).toBe('Service public')
    expect(outletOf('www.lorient.maville.com').owner).toBe('Groupe Sipa Ouest-France')
    expect(outletOf('www.ouest-france.fr').owner).toBe('Groupe Sipa Ouest-France')
    expect(outletOf('hitwest.ouest-france.fr').owner).toBe('Groupe 1981')
    expect(outletOf('exemple.org').owner).toBe('Non renseigné')
  })

  it('range les propriétaires inconnus en dernier', () => {
    const rows = [...Array.from({ length: 5 }, () => row('inconnu.org')), row('cnews.fr')]
    expect(aggregate(rows, 'owner').map((o) => o.name)).toEqual([
      'Groupe Canal+ (Bolloré)',
      'Non renseigné',
    ])
  })
})
