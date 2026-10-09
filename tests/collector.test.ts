import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  analyzePending,
  chunk,
  collectSource,
  collectSources,
  mapLimit,
  mergeSameArticle,
  type CollectorDb,
  type Pending,
  type NewReport,
  type NewUnmatched,
} from '@shared/collector.ts'
import type { ExtractedEvent } from '@shared/extraction.ts'
import { GeminiError } from '@shared/gemini.ts'
import type { SchoolCandidate } from '@shared/matching.ts'

const html = readFileSync(new URL('./fixtures/telegram.html', import.meta.url), 'utf8')
const fetchFn = vi.fn(async () => new Response(html, { status: 200 }))

function fakeDb(candidates: Record<string, SchoolCandidate[]>) {
  const seen = new Set<string>()
  const reports: NewReport[] = []
  const unmatched: NewUnmatched[] = []
  const runs: Array<string | null> = []
  const db: CollectorDb = {
    seenIds: async (_s, ids) => new Set(ids.filter((i) => seen.has(i))),
    markSeen: async (_s, ids) => void ids.forEach((i) => seen.add(i)),
    matchSchool: async (name) => candidates[name] ?? [],
    nearbySchools: async (lat) =>
      lat > 50.6
        ? [
            { uai: '0590001A', name: 'Lycée Pasteur', distance_m: 120 },
            { uai: '0590002B', name: 'Lycée Faidherbe', distance_m: 600 },
          ]
        : [],
    schoolsInCity: async (city) => (city === 'Hanches' ? [{ uai: '0280000A' }] : []),
    schoolInfo: async (uai) => ({
      name: 'Lycée Test',
      city: 'Lille',
      level: uai === '0590099Z' ? 'superieur' : 'lycee',
    }),
    insertReport: async (r) => {
      if (reports.some((x) => x.source_url === r.source_url && x.school_uai === r.school_uai))
        return 'duplicate'
      reports.push(r)
      return 'inserted'
    },
    insertUnmatched: async (u) => void unmatched.push(u),
    recordRun: async (r) => void runs.push(r.error),
  }
  return { db, seen, reports, unmatched, runs }
}

const source = {
  id: 'src-1',
  kind: 'telegram' as const,
  identifier: 'mobilycee',
  label: 'Mobilycée',
  source_type: 'collecteur' as const,
}
const now = new Date('2026-10-05T09:00:00Z')
const besancon: SchoolCandidate = {
  uai: '0000002B',
  name: 'Lycée Victor Hugo',
  city: 'Besançon',
  name_score: 1,
  city_score: 1,
  score: 1,
}

describe('collectSource', () => {
  it('fetch -> filtre -> IA -> matching -> report, puis déduplique au passage suivant', async () => {
    const { db, reports, seen, runs } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const extract = vi.fn(
      async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
        {
          item_id: batch[0]?.id ?? '',
          school_name: 'Lycée Victor-Hugo',
          city: 'Besançon',
          status: 'bloque',
          observed_at: '2026-10-05T05:00:00Z',
          certainty: 'haute',
        },
      ],
    )

    const r1 = await collectSource(source, { db, fetchFn, extract, now })
    expect(r1).toMatchObject({
      fetched: 2,
      new_items: 2,
      relevant: 1,
      events: 1,
      reports: 1,
      error: null,
    })
    expect(reports[0]).toEqual({
      school_uai: '0000002B',
      status: 'bloque',
      source_type: 'collecteur',
      source_url: 'https://t.me/mobilycee/101',
      source_domain: 't.me',
      source_id: 'src-1',
      certainty: 'haute',
      observed_at: '2026-10-05T05:00:00.000Z',
      published_at: expect.any(String),
      extracted_observed_at: '2026-10-05T05:00:00Z',
      date_basis: 'extracted',
    })
    expect(seen.size).toBe(2)
    expect(extract).toHaveBeenCalledTimes(1)

    const r2 = await collectSource(source, { db, fetchFn, extract, now })
    expect(r2).toMatchObject({ new_items: 0, reports: 0 })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(runs).toEqual([null, null])
  })

  it('écarte les faibles certitudes et stocke les non-rattachés', async () => {
    const { db, reports, unmatched } = fakeDb({})
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée Inconnu',
        city: 'Nulle-Part',
        status: 'bloque',
        observed_at: null,
        certainty: 'haute',
      },
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée Victor-Hugo',
        city: 'Besançon',
        status: 'bloque',
        observed_at: null,
        certainty: 'faible',
      },
    ]
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(r).toMatchObject({ unmatched: 1, low_certainty: 1, reports: 0 })
    expect(reports).toHaveLength(0)
    expect(unmatched[0]).toMatchObject({
      school_name: 'Lycée Inconnu',
      observed_at: '2026-10-05T07:12:00.000Z',
    })
  })

  it("ne marque pas le lot traité si l'IA échoue", async () => {
    const { db, seen, runs } = fakeDb({})
    const extract = async () => {
      throw new Error('Gemini HTTP 503')
    }
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(r.error).toBe('Gemini HTTP 503')
    expect([...seen]).toEqual(['mobilycee/103'])
    expect(runs).toEqual(['Gemini HTTP 503'])
  })

  it('ignore les éléments trop anciens', async () => {
    const { db } = fakeDb({})
    const extract = vi.fn(async () => [])
    const r = await collectSource(source, {
      db,
      fetchFn,
      extract,
      now: new Date('2026-10-10T00:00:00Z'),
    })
    expect(r.new_items).toBe(0)
    expect(extract).not.toHaveBeenCalled()
  })
})

describe('collectSources : plusieurs sources, lots communs', () => {
  it("regroupe les éléments de toutes les sources dans un seul appel à l'IA, sans doublon d'analyse", async () => {
    const { db, reports } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const sourceB = { ...source, id: 'src-2', identifier: 'autre', label: 'Autre' }
    const extract = vi.fn(async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> =>
      batch.map((b) => ({
        item_id: b.id,
        school_name: 'Lycée Victor-Hugo',
        city: 'Besançon',
        status: 'bloque' as const,
        observed_at: null,
        certainty: 'haute' as const,
      })),
    )
    const results = await collectSources([source, sourceB], { db, fetchFn, extract, now })
    expect(extract).toHaveBeenCalledTimes(1)
    // Les deux sources de test lisent la même page : même article, analysé une seule fois,
    // et la 2e source l'enregistre comme doublon.
    expect(extract.mock.calls[0]?.[0]).toHaveLength(1)
    expect(results.map((r) => [r.source_id, r.events, r.reports, r.duplicates, r.error])).toEqual([
      ['src-1', 1, 1, 0, null],
      ['src-2', 0, 0, 1, null],
    ])
    expect(reports.map((r) => r.source_id)).toEqual(['src-1'])
  })

  it("une source en erreur n'empêche pas les autres", async () => {
    const { db } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const failing = vi.fn(async (url: string) =>
      url.includes('cassee')
        ? new Response('', { status: 500 })
        : new Response(html, { status: 200 }),
    )
    const broken = { ...source, id: 'src-x', identifier: 'cassee', label: 'Cassée' }
    const extract = async (): Promise<ExtractedEvent[]> => []
    const results = await collectSources([broken, source], { db, fetchFn: failing, extract, now })
    expect(results[0]?.error).toMatch(/HTTP 500/)
    expect(results[1]).toMatchObject({ error: null, relevant: 1 })
  })

  it('mapLimit respecte la limite de concurrence et l’ordre', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBe(2)
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('nom générique et commune à lycée unique', () => {
  it('« Lycée de Hanches » est rattaché au seul lycée de la commune', async () => {
    const { db, reports, unmatched } = fakeDb({})
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée de Hanches',
        city: 'Hanches',
        status: 'bloque',
        observed_at: null,
        certainty: 'haute',
      },
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée',
        city: 'Paris',
        status: 'bloque',
        observed_at: null,
        certainty: 'haute',
      },
    ]
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(reports.map((x) => x.school_uai)).toEqual(['0280000A'])
    // Paris : plusieurs lycées (ou aucun connu) -> non rattaché, avec le domaine conservé.
    expect(unmatched).toEqual([
      expect.objectContaining({ school_name: 'Lycée', source_domain: 't.me' }),
    ])
    expect(r).toMatchObject({ reports: 1, unmatched: 1 })
  })
})

describe('journal du collecteur', () => {
  it('trace le devenir de chaque nouvel élément', async () => {
    const { db } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée Victor-Hugo',
        city: 'Besançon',
        status: 'bloque',
        observed_at: null,
        certainty: 'haute',
      },
      {
        item_id: batch[0]?.id ?? '',
        school_name: 'Lycée Victor-Hugo',
        city: 'Besançon',
        status: 'leve',
        observed_at: null,
        certainty: 'faible',
      },
    ]
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(r.items.map((i) => [i.external_id, i.outcome, i.school_uai ?? null])).toEqual([
      ['mobilycee/103', 'hors_sujet', null],
      ['mobilycee/101', 'rattache', '0000002B'],
      ['mobilycee/101', 'certitude_faible', null],
    ])
  })

  it("trace l'erreur de l'IA pour chaque élément du lot", async () => {
    const { db } = fakeDb({})
    const extract = async () => {
      throw new Error('Gemini indisponible')
    }
    const r = await collectSource(source, { db, fetchFn, extract, now })
    expect(r.items.find((i) => i.external_id === 'mobilycee/101')).toMatchObject({
      outcome: 'erreur',
      detail: 'IA : Gemini indisponible',
    })
  })
})

describe('crédit Gemini épuisé (402)', () => {
  it("s'arrête au premier lot refusé et reporte les suivants, sans rien marquer traité", async () => {
    const { db, seen } = fakeDb({})
    const mk = (i: number): Pending => ({
      source,
      item: {
        externalId: `p${i}`,
        url: `https://exemple.fr/${i}`,
        text: 'Blocus au lycée',
        publishedAt: now,
      },
    })
    const extract = vi.fn(async () => {
      throw new GeminiError(402, 'Gemini : crédit épuisé ou plafond de dépense atteint (402).')
    })
    const results = await analyzePending([mk(1), mk(2), mk(3)], [], {
      db,
      fetchFn,
      extract,
      batchSize: 1,
    })
    // Un seul appel : les lots 2 et 3 ne sont même pas tentés.
    expect(extract).toHaveBeenCalledTimes(1)
    expect(results[0]?.items.map((i) => [i.external_id, i.outcome])).toEqual([
      ['p1', 'erreur'],
      ['p2', 'reporte'],
      ['p3', 'reporte'],
    ])
    expect(seen.size).toBe(0)
  })

  it('continue après une autre erreur (503) : seul le 402 coupe le passage', async () => {
    const { db } = fakeDb({})
    const mk = (i: number): Pending => ({
      source,
      item: { externalId: `p${i}`, url: `https://exemple.fr/${i}`, text: 'x', publishedAt: now },
    })
    const extract = vi.fn(async () => {
      throw new GeminiError(503, 'saturé')
    })
    await analyzePending([mk(1), mk(2)], [], { db, fetchFn, extract, batchSize: 1 })
    expect(extract).toHaveBeenCalledTimes(2)
  })
})

describe('carte My Maps dans la collecte', () => {
  it('rattache un point par sa position, même sans mot-clé', async () => {
    const kml = readFileSync(new URL('./fixtures/mymaps.kml', import.meta.url), 'utf8')
    const { db, reports } = fakeDb({})
    const mapsFetch = vi.fn(async () => new Response(kml))
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> =>
      batch.map((b) => ({
        item_id: b.id,
        school_name: 'Lycée Pasteur',
        city: null,
        status: 'bloque' as const,
        observed_at: null,
        certainty: 'moyenne' as const,
      }))
    const mapSource = {
      ...source,
      id: 'map-1',
      kind: 'mymaps' as const,
      identifier: 'MID123456789',
      label: 'Carte',
    }
    const r = await collectSource(mapSource, { db, fetchFn: mapsFetch, extract, now: new Date() })
    // 3 points : Pasteur (rattaché par position), Gambetta (hors zone simulée), Lemonnier (par adresse, inconnu ici).
    expect(r).toMatchObject({ relevant: 3, events: 3, reports: 1, unmatched: 2 })
    expect(reports[0]).toMatchObject({
      school_uai: '0590001A',
      source_url: 'https://www.google.com/maps/d/viewer?mid=MID123456789',
    })
  })
})

describe('borne par source et par passage', () => {
  it('lit les plus récents d’abord et reprend les suivants au passage d’après', async () => {
    const { db } = fakeDb({})
    const long = ' Les élèves ont installé des poubelles devant l’entrée dès 7 h.'.repeat(8)
    const items = [1, 2, 3, 4, 5]
      .map(
        (n) => `<item><title>Blocus au lycée numéro ${n}</title>
          <link>https://www.ouest-france.fr/article-${n}</link><guid>a${n}</guid>
          <pubDate>${new Date(now.getTime() - n * 600_000).toUTCString()}</pubDate>
          <description>${long}</description></item>`,
      )
      .join('')
    const xml = `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`
    const feed = vi.fn(async () => new Response(xml, { status: 200 }))
    const rss = { ...source, id: 'rss-1', kind: 'rss' as const, identifier: 'https://x.fr/rss' }
    const seenBatches: string[][] = []
    const extract = vi.fn(
      async (batch: ReadonlyArray<{ id: string; item: { externalId: string } }>) => {
        seenBatches.push(batch.map((b) => b.item.externalId))
        return [] as ExtractedEvent[]
      },
    )
    const opts = { db, fetchFn: feed, extract, now, maxItemsPerSource: 2 }
    const runs = []
    for (let i = 0; i < 4; i++) runs.push((await collectSources([rss], opts))[0]?.relevant)
    expect(runs).toEqual([2, 2, 1, 0])
    expect(seenBatches).toEqual([['a1', 'a2'], ['a3', 'a4'], ['a5']])
  })
})

describe('adresse canonique', () => {
  it('retire suivi, fragment et « / » final, garde le reste', async () => {
    const { canonicalUrl } = await import('@shared/domain.ts')
    const base = 'https://www.ici.fr/occitanie/tarbes/mobilisation-8218869'
    expect(canonicalUrl(`${base}?at_medium=lien_RSS&at_locale=56`)).toBe(base)
    expect(canonicalUrl(`${base}/?utm_source=x#haut`)).toBe(base)
    expect(canonicalUrl('https://exemple.fr/a?id=12&utm_medium=rss')).toBe(
      'https://exemple.fr/a?id=12',
    )
    expect(canonicalUrl('https://exemple.fr/a?fbclid=z&id=12')).toBe('https://exemple.fr/a?id=12')
    expect(canonicalUrl('pas une url')).toBe('pas une url')
  })
})

describe('même article reçu par plusieurs sources', () => {
  const sourceB = { ...source, id: 'src-2', label: 'Autre flux' }
  const article = (id: string, url: string, text: string, src = source): Pending => ({
    source: src,
    item: { externalId: id, url, text, publishedAt: now },
  })

  it('fusionne les textes d’une même adresse (suivi retiré) et garde le reste', () => {
    const a = article(
      'a',
      'https://j.example/article-1?utm_source=x',
      'Blocus au lycée Hugo\nBesançon',
    )
    const b = article(
      'b',
      'https://j.example/article-1',
      'Blocus au lycée Hugo\nAussi au lycée Pasteur',
      sourceB,
    )
    const c = article('c', 'https://j.example/autre', 'Autre article lycée')
    const geo: Pending = {
      source,
      item: {
        externalId: 'g',
        url: 'https://j.example/article-1',
        text: 'point',
        publishedAt: now,
        geo: { lat: 1, lng: 1 },
      },
    }
    const { kept, absorbed } = mergeSameArticle([a, b, c, geo])
    expect(kept).toHaveLength(3)
    expect(absorbed).toHaveLength(1)
    expect(kept[0]?.item.text).toBe('Blocus au lycée Hugo\nBesançon\nAussi au lycée Pasteur')
    expect(absorbed[0]?.into).toBe(kept[0])
  })

  it('n’appelle l’IA qu’une fois, journalise l’autre source en doublon et la marque traitée', async () => {
    const { db, seen, reports } = fakeDb({ 'Lycée Victor-Hugo': [besancon] })
    const extract = vi.fn(
      async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> => [
        {
          item_id: batch[0]?.id ?? '',
          school_name: 'Lycée Victor-Hugo',
          city: 'Besançon',
          status: 'bloque',
          observed_at: null,
          certainty: 'haute',
        },
      ],
    )
    const pending = [
      article('a', 'https://j.example/article-1', 'Blocus au lycée Victor-Hugo à Besançon'),
      article(
        'b',
        'https://j.example/article-1?utm_medium=y',
        'Même blocus, autre extrait',
        sourceB,
      ),
    ]
    const results = await analyzePending(pending, [], { db, fetchFn, extract, now })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract.mock.calls[0]?.[0]).toHaveLength(1)
    expect(reports).toHaveLength(1)
    expect(seen.has('a') && seen.has('b')).toBe(true)
    const second = results.find((r) => r.source_id === 'src-2')
    expect(second?.items[0]?.outcome).toBe('doublon')
    expect(second?.duplicates).toBe(1)
  })
})

describe('week-end : un lycée est fermé', () => {
  const run = async (
    uai: string,
    observed_at: string,
    status: 'bloque' | 'filtrant' = 'bloque',
  ) => {
    const { db, reports } = fakeDb({
      'Lycée Test': [
        { uai, name: 'Lycée Test', city: 'Lille', name_score: 1, city_score: 1, score: 1 },
      ],
    })
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> =>
      batch.slice(0, 1).map((b) => ({
        item_id: b.id,
        school_name: 'Lycée Test',
        city: 'Lille',
        status,
        observed_at,
        certainty: 'haute' as const,
      }))
    // Publié le samedi 3 octobre 2026 à 10 h (Paris) : le fait retenu tombe un week-end.
    const sat = new Date('2026-10-03T08:00:00Z')
    const fetchSat = vi.fn(
      async () => new Response(html.replaceAll('2026-10-05', '2026-10-03'), { status: 200 }),
    )
    const r = await collectSource(source, { db, fetchFn: fetchSat, extract, now: sat })
    return { r, reports }
  }

  it('ne crée pas de « bloqué » un samedi pour un lycée', async () => {
    const { r, reports } = await run('0590010A', '2026-10-03T07:00:00Z')
    expect(reports).toHaveLength(0)
    expect(r.items.some((i) => i.detail === 'lycée fermé le week-end')).toBe(true)
  })

  it('écarte un fait daté de plus de 7 jours avant la publication (archive, rétrospective)', async () => {
    const { r, reports } = await run('0590099Z', '2020-11-04')
    expect(reports).toHaveLength(0)
    expect(r.items.some((i) => i.detail?.startsWith('fait ancien'))).toBe(true)
  })

  it('garde une fac (occupation possible le week-end)', async () => {
    const { reports } = await run('0590099Z', '2026-10-03T07:00:00Z')
    expect(reports).toHaveLength(1)
  })

  it('garde un statut autre que « bloqué »', async () => {
    const { reports } = await run('0590010A', '2026-10-03T07:00:00Z', 'filtrant')
    expect(reports).toHaveLength(1)
  })
})

describe('juge (mode observation)', () => {
  const fakeJudge = (probability: number) =>
    vi.fn(async () => ({
      probability,
      nature: 'blocage' as const,
      natureProbabilities: {},
      level: 'lycee' as const,
      levelProbabilities: {},
      model: 'jev-1.13.0',
      chars: 500,
    }))
  const run = async (judge: ReturnType<typeof fakeJudge> | undefined, text: string) => {
    const { db, reports } = fakeDb({
      'Lycée Test': [
        {
          uai: '0590010A',
          name: 'Lycée Test',
          city: 'Lille',
          name_score: 1,
          city_score: 1,
          score: 1,
        },
      ],
    })
    const extract = async (batch: ReadonlyArray<{ id: string }>): Promise<ExtractedEvent[]> =>
      batch.slice(0, 1).map((b) => ({
        item_id: b.id,
        school_name: 'Lycée Test',
        city: 'Lille',
        status: 'bloque' as const,
        observed_at: null,
        certainty: 'haute' as const,
      }))
    const long = html.replace(/<div class="tgme_widget_message_text[^>]*>/, (m) => `${m}${text}`)
    await collectSource(source, {
      db,
      fetchFn: vi.fn(async () => new Response(long)),
      extract,
      now,
      judge,
    })
    return reports
  }

  it('enregistre le score, la nature et le niveau sans changer la décision', async () => {
    const judge = fakeJudge(0.12)
    const reports = await run(judge, 'x'.repeat(10))
    expect(reports).toHaveLength(1)
    expect(judge).toHaveBeenCalled()
    expect(reports[0]).toMatchObject({
      judge_score: 0.12,
      judge_nature: 'blocage',
      judge_level: 'lycee',
      judge_model: 'jev-1.13.0',
    })
  })
  it('sans juge, aucun champ judge_*', async () => {
    const reports = await run(undefined, 'x')
    expect(reports[0]).not.toHaveProperty('judge_score')
  })
})
