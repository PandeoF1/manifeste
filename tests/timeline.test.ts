import { describe, expect, it } from 'vitest'
import {
  advance,
  bucketSize,
  bucketize,
  fmtAgo,
  fmtMoment,
  fmtTick,
  hourChoices,
  parseTimeline,
  rangeStart,
  statusesAt,
  type TimelineData,
} from '../src/lib/timeline'

const H = 3_600_000
const t0 = Date.parse('2026-10-05T10:00:00Z')

const school = (uai: string, department = '75') => ({
  uai,
  name: `Lycée ${uai}`,
  city: 'Paris',
  department,
  academy: 'Paris',
  lat: 48.85,
  lng: 2.35,
  level: 'lycee' as const,
})

const data: TimelineData = {
  schools: [school('A'), school('B', '31')],
  events: [
    { u: 'A', s: 'bloque', t: t0, k: 'dom:presse' },
    { u: 'B', s: 'filtrant', t: t0 + 1 * H, k: 'dom:x' },
    { u: 'A', s: 'bloque', t: t0 + 2 * H, k: 'src:1' },
    { u: 'A', s: 'leve', t: t0 + 3 * H, k: 'dom:presse' },
    { u: 'B', s: 'bloque', t: t0 + 8 * H, k: 'dom:x' },
  ],
}

describe('statusesAt', () => {
  it('rien avant le premier signalement', () => {
    expect(statusesAt(data, t0 - 1, 5)).toEqual([])
  })

  it('statut = dernier signalement de la fenêtre, plus récent en premier', () => {
    const rows = statusesAt(data, t0 + 1.5 * H, 5)
    expect(rows.map((r) => [r.uai, r.status])).toEqual([
      ['B', 'filtrant'],
      ['A', 'bloque'],
    ])
  })

  it('un établissement levé reste affiché comme levé', () => {
    const rows = statusesAt(data, t0 + 4 * H, 5)
    expect(rows.find((r) => r.uai === 'A')?.status).toBe('leve')
  })

  it('compte les sources distinctes de la fenêtre', () => {
    const rows = statusesAt(data, t0 + 2.5 * H, 5)
    expect(rows.find((r) => r.uai === 'A')?.source_count).toBe(2)
    expect(rows.find((r) => r.uai === 'B')?.source_count).toBe(1)
  })

  it('un signalement sort de la fenêtre au bout de `hours`', () => {
    // A: dernier signal à +3 h ; avec 5 h il sort strictement après +8 h.
    expect(statusesAt(data, t0 + 7.9 * H, 5).some((r) => r.uai === 'A')).toBe(true)
    expect(statusesAt(data, t0 + 8 * H, 5).some((r) => r.uai === 'A')).toBe(false)
  })

  it('une fenêtre plus longue garde les anciens signaux', () => {
    const rows = statusesAt(data, t0 + 9 * H, 24)
    expect(rows.map((r) => r.uai).sort()).toEqual(['A', 'B'])
    expect(rows.find((r) => r.uai === 'B')?.status).toBe('bloque')
  })

  it('ne regarde jamais le futur', () => {
    const rows = statusesAt(data, t0 + 0.5 * H, 5)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.last_signal_at).toBe(new Date(t0).toISOString())
  })

  it("ignore un signalement dont l'établissement est inconnu", () => {
    const odd: TimelineData = { schools: [], events: [{ u: 'Z', s: 'bloque', t: t0, k: 'k' }] }
    expect(statusesAt(odd, t0 + H, 5)).toEqual([])
  })
})

describe('parseTimeline', () => {
  it('accepte la réponse de la base et trie les événements', () => {
    const parsed = parseTimeline({
      schools: [school('A')],
      events: [
        { u: 'A', s: 'leve', t: 2000, k: 'k' },
        { u: 'A', s: 'bloque', t: 1000, k: 'k' },
      ],
    })
    expect(parsed.events.map((e) => e.t)).toEqual([1000, 2000])
  })

  it('ignore les lignes invalides sans perdre les autres', () => {
    const parsed = parseTimeline({
      schools: [school('A'), { uai: 'B', name: null }],
      events: [
        { u: 'A', s: 'autre', t: 1, k: 'k' },
        { u: 'A', s: 'bloque', t: 2, k: 'k' },
      ],
    })
    expect(parsed.schools.map((s) => s.uai)).toEqual(['A'])
    expect(parsed.events).toHaveLength(1)
  })

  it('accepte un signalement sans source (signalement sur place)', () => {
    const parsed = parseTimeline({
      schools: [school('A')],
      events: [{ u: 'A', s: 'bloque', t: 1, k: null }],
    })
    expect(parsed.events).toHaveLength(1)
    expect(statusesAt(parsed, 2, 5)[0]?.source_count).toBe(0)
  })

  it("refuse une réponse qui n'a pas la bonne forme", () => {
    expect(() => parseTimeline([])).toThrow()
    expect(() => parseTimeline({ schools: [] })).toThrow()
  })
})

describe('bucketize', () => {
  it('range les signalements par tranche et par statut', () => {
    const buckets = bucketize(data.events, t0, t0 + 4 * H, H)
    expect(buckets).toHaveLength(4)
    expect(buckets.map((b) => b.total)).toEqual([1, 1, 1, 1])
    expect(buckets[1]).toMatchObject({ filtrant: 1, bloque: 0 })
    expect(buckets[3]).toMatchObject({ leve: 1 })
  })

  it('ignore ce qui est hors de la fenêtre', () => {
    const buckets = bucketize(data.events, t0 + 4 * H, t0 + 6 * H, H)
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(0)
  })

  it('un signalement pile à la fin tombe dans la dernière tranche', () => {
    const buckets = bucketize(data.events, t0 + 5 * H, t0 + 8 * H, H)
    expect(buckets[buckets.length - 1]?.bloque).toBe(1)
  })
})

describe('bucketSize', () => {
  it('donne des barres rondes, au plus ~96', () => {
    expect(bucketSize(24 * H)).toBe(15 * 60_000)
    expect(bucketSize(7 * 24 * H)).toBe(2 * H)
    expect(bucketSize(30 * 24 * H)).toBe(12 * H)
  })
})

describe('rangeStart', () => {
  const settings = { statusTtlHours: 5, movementStart: '2026-09-14' }
  const now = Date.parse('2026-10-05T12:00:00Z')
  it('remonte de la durée choisie', () => {
    expect(new Date(rangeStart('24h', settings, now)).toISOString()).toBe(
      '2026-10-04T12:00:00.000Z',
    )
    expect(new Date(rangeStart('3j', settings, now)).toISOString()).toBe('2026-10-02T12:00:00.000Z')
  })
  it('jamais avant le début du mouvement', () => {
    const early = Date.parse('2026-09-15T12:00:00Z')
    expect(new Date(rangeStart('7j', settings, early)).toISOString()).toBe(
      '2026-09-13T22:00:00.000Z',
    )
    expect(new Date(rangeStart('tout', settings, now)).toISOString()).toBe(
      '2026-09-13T22:00:00.000Z',
    )
  })
})

describe('advance', () => {
  it('parcourt toute la frise en 30 s à la vitesse 1', () => {
    expect(advance(0, 30_000, 0, 3000, 1)).toBe(3000)
    expect(advance(0, 15_000, 0, 3000, 1)).toBe(1500)
    expect(advance(0, 15_000, 0, 3000, 2)).toBe(3000)
  })
  it('reste dans les bornes', () => {
    expect(advance(2900, 10_000, 0, 3000, 4)).toBe(3000)
    expect(advance(10, -10_000, 0, 3000, 1)).toBe(0)
  })
})

describe('hourChoices', () => {
  it('ajoute le réglage du site sans doublon, trié', () => {
    expect(hourChoices(5)).toEqual([1, 3, 5, 6, 12, 24, 48])
    expect(hourChoices(12)).toEqual([1, 3, 6, 12, 24, 48])
  })
  it("garde la valeur d'un lien partagé même hors de la liste", () => {
    expect(hourChoices(5, 8)).toEqual([1, 3, 5, 6, 8, 12, 24, 48])
  })
})

describe('formats', () => {
  it('heure de Paris', () => {
    expect(fmtMoment(Date.parse('2026-10-08T12:30:00Z'))).toBe('jeu. 8 oct. · 14 h 30')
  })
  it('minuit reste 00 h', () => {
    expect(fmtMoment(Date.parse('2026-10-07T22:05:00Z'))).toContain('00 h 05')
  })
  it('graduation : heure sur 24 h, jour sur 7 jours', () => {
    const ms = Date.parse('2026-10-08T12:00:00Z')
    expect(fmtTick(ms, 24 * H)).toBe('8 oct. 14 h')
    expect(fmtTick(ms, 7 * 24 * H)).toBe('8 oct.')
  })
  it('il y a…', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    expect(fmtAgo(now - 30_000, now)).toBe("à l'instant")
    expect(fmtAgo(now - 12 * 60_000, now)).toBe('il y a 12 min')
    expect(fmtAgo(now - 3 * H, now)).toBe('il y a 3 h')
    expect(fmtAgo(now - 72 * H, now)).toBe('il y a 3 j')
  })
})
