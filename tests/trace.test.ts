import { describe, expect, it, vi } from 'vitest'
import {
  classifyUrl,
  createTracer,
  shortUrl,
  tracingFetch,
  type TraceEvent,
} from '@shared/trace.ts'

describe('classifyUrl', () => {
  const feeds = new Set([
    'https://www.ladepeche.fr/rss.xml',
    'https://news.google.com/rss/search?q=blocus+when:1d&hl=fr',
  ])
  it.each([
    ['https://news.google.com/rss/search?q=blocus+when:1d&hl=fr', 'google-news'],
    ['https://news.google.com/rss/articles/CBMiAB?oc=5', 'google-decode'],
    ['https://news.google.com/_/DotsSplashUi/data/batchexecute', 'google-decode'],
    ['https://www.ladepeche.fr/rss.xml', 'rss'],
    ['https://www.ladepeche.fr/2026/10/06/blocus-lycee.html', 'pages'],
    ['https://t.me/s/rapportsdeforce', 'telegram'],
    ['https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=x', 'bluesky'],
    ['https://www.google.com/maps/d/kml?mid=abc&forcekml=1', 'mymaps'],
    [
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      'gemini',
    ],
    ['https://abc.supabase.co/functions/v1/collect', 'lecteurs'],
    ['https://basta.media/spip.php?page=backend', 'rss'],
    ['pas une url', 'pages'],
  ])('%s → %s', (url, node) => {
    expect(classifyUrl(url, feeds)).toBe(node)
  })
})

describe('shortUrl', () => {
  it('hôte sans www et chemin abrégé', () => {
    expect(shortUrl('https://www.ouest-france.fr/')).toBe('ouest-france.fr')
    expect(
      shortUrl(
        'https://www.ouest-france.fr/bretagne/rennes-35000/un-tres-long-chemin-d-article.html',
      ),
    ).toBe('ouest-france.fr/bretagne/rennes-35000/un-t…')
  })
})

describe('createTracer', () => {
  it('envoie par paquets et tout est parti après flush', async () => {
    const batches: TraceEvent[][] = []
    const tracer = createTracer('run-1', async (b) => void batches.push(b), {
      maxBatch: 2,
      intervalMs: 10_000,
      now: () => 42,
    })
    for (let i = 0; i < 5; i++)
      tracer.emit({ actor: 'lecteurs', target: 'rss', phase: 'req', label: `e${i}` })
    await tracer.flush()
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1])
    expect(batches.flat().every((e) => e.run_id === 'run-1' && e.t === 42)).toBe(true)
  })

  it('une trace qui échoue ne casse jamais la collecte', async () => {
    const tracer = createTracer('run-1', async () => {
      throw new Error('base indisponible')
    })
    tracer.emit({ actor: 'collecteur', target: 'base', phase: 'req', label: 'x' })
    await expect(tracer.flush()).resolves.toBeUndefined()
  })
})

describe('tracingFetch', () => {
  it('trace aller et retour sans changer la réponse', async () => {
    const events: TraceEvent[] = []
    const tracer = createTracer('r', async (b) => void events.push(...b))
    const f = tracingFetch(async () => new Response('ok', { status: 200 }), tracer, 'lecteurs')
    const res = await f('https://t.me/s/canal')
    expect(await res.text()).toBe('ok')
    await tracer.flush()
    expect(events.map((e) => [e.target, e.phase, e.status ?? null])).toEqual([
      ['telegram', 'req', null],
      ['telegram', 'res', 200],
    ])
  })

  it('HTTP en erreur et exception réseau sont tracées en err, l’exception est relancée', async () => {
    const events: TraceEvent[] = []
    const tracer = createTracer('r', async (b) => void events.push(...b))
    const http500 = tracingFetch(async () => new Response('', { status: 500 }), tracer, 'lecteurs')
    expect((await http500('https://www.lemonde.fr/rss')).status).toBe(500)
    const boom = tracingFetch(
      vi.fn(async () => {
        throw new Error('timeout')
      }),
      tracer,
      'collecteur',
    )
    await expect(
      boom('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent'),
    ).rejects.toThrow('timeout')
    await tracer.flush()
    expect(events.filter((e) => e.phase === 'err').map((e) => [e.target, e.label])).toEqual([
      ['rss', 'lemonde.fr/rss'],
      ['gemini', 'gemini-x'],
    ])
  })
})
