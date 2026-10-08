import { describe, expect, it } from 'vitest'
import {
  isRelevant,
  meetsCertainty,
  parseExtraction,
  resolveObservedAt,
} from '@shared/extraction.ts'
import { pickMatch, type SchoolCandidate } from '@shared/matching.ts'
import { newSourceSchema, normalizeSourceIdentifier } from '@shared/sources.ts'

describe('filtre lexical', () => {
  it('garde les messages pertinents', () => {
    expect(isRelevant('Blocus au lycée Victor-Hugo')).toBe(true)
    expect(isRelevant('Barrage filtrant devant le LP')).toBe(true)
    expect(isRelevant('Concert ce soir')).toBe(false)
    expect(isRelevant('Blocus de la fac de Tolbiac par les étudiants')).toBe(true)
    expect(isRelevant('La mobilisation étudiante gagne Nanterre')).toBe(true)
  })

  it('rattrape des titres que l’ancien filtre laissait passer', () => {
    // Titres réels écartés comme hors sujet avant l'élargissement.
    expect(
      isRelevant('Pays de la Loire : le blocage de la cité scolaire de Saint-Nazaire tendu'),
    ).toBe(true)
    expect(
      isRelevant(
        'Blocage de Sciences Po : des gaz lacrymogènes utilisés pour disperser les étudiants',
      ),
    ).toBe(true)
    expect(
      isRelevant('Colère des lycéens à Montpellier : la préfète interdit les rassemblements'),
    ).toBe(true)
    expect(isRelevant('Blocage de la fac de droit de Strasbourg')).toBe(true)
  })

  it('ne retient toujours pas le hors-sujet', () => {
    expect(isRelevant('Résultats du baccalauréat : la liste des admis')).toBe(false)
    expect(isRelevant('Grève des contrôleurs aériens ce week-end')).toBe(false)
    expect(isRelevant('Une école de Rennes fête ses 100 ans')).toBe(false)
  })

  it('garde tout ce que l’ancien filtre gardait', () => {
    for (const text of [
      'Lycée Victor-Hugo',
      'Le LGT est fermé',
      'Piquet de grève devant le lycée',
      'Barrage filtrant à la porte',
      'Mobilisation lycéenne : point sur la situation',
      'Il est bloqué ce matin',
    ]) {
      expect(isRelevant(text), text).toBe(true)
    }
  })
})

describe('parseExtraction (schéma zod strict)', () => {
  const ids = new Set(['0', '1'])
  it('garde les événements valides et rejette le reste', () => {
    const out = parseExtraction(
      {
        events: [
          {
            item_id: '0',
            school_name: 'Lycée Victor-Hugo',
            city: 'Besançon',
            status: 'bloque',
            observed_at: null,
            certainty: 'haute',
          },
          {
            item_id: '1',
            school_name: 'Lycée X',
            city: null,
            status: 'en grève',
            observed_at: null,
            certainty: 'haute',
          },
          {
            item_id: '9',
            school_name: 'Lycée Y',
            city: null,
            status: 'leve',
            observed_at: null,
            certainty: 'haute',
          },
          {
            item_id: '1',
            school_name: 'ab',
            city: null,
            status: 'leve',
            observed_at: null,
            certainty: 'haute',
          },
          'nimporte quoi',
        ],
      },
      ids,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.school_name).toBe('Lycée Victor-Hugo')
  })
  it('renvoie [] sur une sortie hors schéma', () => {
    expect(parseExtraction({ foo: 1 }, ids)).toEqual([])
    expect(parseExtraction(null, ids)).toEqual([])
  })
})

describe('certitude', () => {
  it('compare les niveaux', () => {
    expect(meetsCertainty('haute', 'moyenne')).toBe(true)
    expect(meetsCertainty('moyenne', 'moyenne')).toBe(true)
    expect(meetsCertainty('faible', 'moyenne')).toBe(false)
  })
})

describe('resolveObservedAt', () => {
  const published = new Date('2026-10-04T10:00:00Z')
  it('utilise la date extraite si plausible', () => {
    expect(resolveObservedAt('2026-10-04T07:00:00+02:00', published).toISOString()).toBe(
      '2026-10-04T05:00:00.000Z',
    )
  })
  it('retombe sur la publication si absente, invalide, future ou trop ancienne', () => {
    for (const v of [null, 'demain', '2026-10-04T13:00:00Z', '2026-09-01T10:00:00Z']) {
      expect(resolveObservedAt(v, published)).toEqual(published)
    }
  })
})

describe('pickMatch', () => {
  const c = (uai: string, name_score: number, city_score: number): SchoolCandidate => ({
    uai,
    name: 'n',
    city: 'c',
    name_score,
    city_score,
    score: 0.65 * name_score + 0.35 * city_score,
  })
  it('choisit le bon homonyme grâce à la ville', () => {
    expect(pickMatch([c('B', 1, 1), c('A', 1, 0)], true)?.uai).toBe('B')
  })
  it('garde le jumeau d’un même lieu, refuse un homonyme éloigné', () => {
    const twin = (uai: string, name: string, lng: number): SchoolCandidate => ({
      uai,
      name,
      city: 'Montreuil',
      name_score: 1,
      city_score: 1,
      score: 1,
      lat: 48.86,
      lng,
    })
    const general = twin('G', 'Lycée Condorcet', 2.44)
    const pro = twin('P', 'Lycée professionnel Condorcet', 2.4402)
    expect(pickMatch([pro, general], true)?.uai).toBe('G')
    const far = twin('F', 'Lycée privé Condorcet', 2.5)
    expect(pickMatch([general, far], true)).toBeNull()
  })
  it('refuse un homonyme sans ville', () => {
    expect(pickMatch([c('A', 1, 0), c('B', 1, 0)], false)).toBeNull()
  })
  it('accepte un nom exact unique sans ville', () => {
    expect(pickMatch([c('A', 1, 0), c('B', 0.4, 0)], false)?.uai).toBe('A')
  })
  it('refuse une ville incohérente', () => {
    expect(pickMatch([c('A', 1, 0.2)], true)).toBeNull()
  })
  it('refuse un nom trop éloigné', () => {
    expect(pickMatch([c('A', 0.5, 1)], true)).toBeNull()
  })
  it('refuse sans candidat', () => {
    expect(pickMatch([], true)).toBeNull()
  })
})

describe('sources', () => {
  it('normalise les identifiants', () => {
    expect(normalizeSourceIdentifier('telegram', 'https://t.me/s/MobiLycee')).toBe('mobilycee')
    expect(normalizeSourceIdentifier('telegram', '@mobilycee')).toBe('mobilycee')
    expect(
      normalizeSourceIdentifier('bluesky', 'https://bsky.app/profile/Syndicat.bsky.social'),
    ).toBe('syndicat.bsky.social')
    expect(() => normalizeSourceIdentifier('rss', 'http://exemple.fr/feed')).toThrow()
    expect(() => normalizeSourceIdentifier('telegram', 'a b')).toThrow()
  })
  it('valide le formulaire', () => {
    const ok = newSourceSchema.safeParse({
      kind: 'telegram',
      identifier: 't.me/canal_lyceen',
      label: 'Canal',
      source_type: 'collecteur',
      trusted: false,
    })
    expect(ok.success && ok.data.identifier).toBe('canal_lyceen')
    const ko = newSourceSchema.safeParse({
      kind: 'bluesky',
      identifier: '???',
      label: 'x',
      source_type: 'collecteur',
      trusted: false,
    })
    expect(ko.success).toBe(false)
  })
})

describe('préréglages de sources', () => {
  it('sont tous valides et sans doublon', async () => {
    const { SOURCE_PRESETS, newSourceSchema } = await import('@shared/sources.ts')
    const keys = new Set<string>()
    for (const { group: _group, ...p } of SOURCE_PRESETS) {
      const parsed = newSourceSchema.safeParse(p)
      expect(parsed.success, p.label).toBe(true)
      // L'identifiant est déjà sous forme normalisée (sinon l'upsert créerait un doublon).
      expect(parsed.success && parsed.data.identifier).toBe(p.identifier)
      keys.add(`${p.kind}:${p.identifier}`)
    }
    expect(keys.size).toBe(SOURCE_PRESETS.length)
  })
})
