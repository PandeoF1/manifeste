import { describe, expect, it } from 'vitest'
import { createExtractor, extractEvents, modelsFromEnv } from '@shared/gemini.ts'
import type { ScrapedItem } from '@shared/fetchers/types.ts'

const item: ScrapedItem = {
  externalId: 'a',
  url: 'https://t.me/c/1',
  text: 'Blocus au lycée Victor-Hugo de Besançon',
  publishedAt: new Date('2026-10-05T07:00:00Z'),
}
const batch = [{ id: '0', item }]
const ok = () =>
  Response.json({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                events: [
                  {
                    item_id: '0',
                    school_name: 'Lycée Victor-Hugo',
                    city: 'Besançon',
                    status: 'bloque',
                    observed_at: null,
                    certainty: 'haute',
                  },
                ],
              }),
            },
          ],
        },
      },
    ],
  })
const err = (status: number) =>
  Response.json({ error: { code: status, message: 'Gemini error message.' } }, { status })

function fakeFetch(responses: Response[]) {
  const calls: string[] = []
  const fetchFn = async (url: string) => {
    calls.push(url.match(/models\/([^:]+)/)?.[1] ?? url)
    const next = responses.shift()
    if (!next) throw new Error('plus de réponse')
    return next
  }
  return { fetchFn, calls }
}
const sleep = async () => {}
const run = (fetchFn: (url: string) => Promise<Response>) =>
  extractEvents({ apiKey: 'k', models: ['m1', 'm2'], fetchFn, sleep }, batch)

describe('extractEvents : résistance aux erreurs Gemini', () => {
  it('réessaie le même modèle après un 503', async () => {
    const { fetchFn, calls } = fakeFetch([err(503), ok()])
    expect(await run(fetchFn)).toHaveLength(1)
    expect(calls).toEqual(['m1', 'm1'])
  })

  it('bascule sur le modèle de secours si le principal reste saturé', async () => {
    const { fetchFn, calls } = fakeFetch([err(503), err(503), ok()])
    expect(await run(fetchFn)).toHaveLength(1)
    expect(calls).toEqual(['m1', 'm1', 'm2'])
  })

  it('passe directement au suivant sur quota atteint (429), sans réessayer', async () => {
    const { fetchFn, calls } = fakeFetch([err(429), ok()])
    expect(await run(fetchFn)).toHaveLength(1)
    expect(calls).toEqual(['m1', 'm2'])
  })

  it('passe directement au suivant si le modèle est fermé pour ce compte (404)', async () => {
    const { fetchFn, calls } = fakeFetch([err(404), ok()])
    expect(await run(fetchFn)).toHaveLength(1)
    expect(calls).toEqual(['m1', 'm2'])
  })

  it('résume chaque modèle si tous échouent', async () => {
    const { fetchFn } = fakeFetch([err(503), err(503), err(404)])
    await expect(run(fetchFn)).rejects.toThrow(
      'Gemini indisponible, repris au prochain passage. m1 : saturé (503) ; m2 : indisponible pour ce compte (404)',
    )
  })

  it("n'insiste pas sur une erreur définitive (clé invalide)", async () => {
    const { fetchFn, calls } = fakeFetch([err(400), ok()])
    await expect(run(fetchFn)).rejects.toThrow(/HTTP 400/)
    expect(calls).toEqual(['m1'])
  })

  it("construit la liste des modèles depuis l'environnement", () => {
    expect(modelsFromEnv(undefined, undefined)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
    ])
    expect(modelsFromEnv('a', 'b, c,,a')).toEqual(['a', 'b', 'c'])
    expect(modelsFromEnv('a', '')).toEqual(['a'])
  })
})

describe('createExtractor : modèle « collant »', () => {
  it('garde le modèle qui a répondu pour les lots suivants', async () => {
    const { fetchFn, calls } = fakeFetch([err(503), err(503), ok(), ok()])
    const { extract, served } = createExtractor({
      apiKey: 'k',
      models: ['m1', 'm2'],
      fetchFn,
      sleep,
    })
    await extract(batch)
    await extract(batch)
    // 2e lot : directement m2, sans retenter m1 saturé.
    expect(calls).toEqual(['m1', 'm1', 'm2', 'm2'])
    expect([...served]).toEqual(['m2'])
  })

  it('résume tous les modèles si aucun ne répond', async () => {
    const { fetchFn } = fakeFetch([err(503), err(503), err(404)])
    const { extract } = createExtractor({ apiKey: 'k', models: ['m1', 'm2'], fetchFn, sleep })
    await expect(extract(batch)).rejects.toThrow(
      'Gemini indisponible, repris au prochain passage. m1 : saturé (503) ; m2 : indisponible pour ce compte (404)',
    )
  })

  it('coupe la réflexion quand un budget est demandé, et réessaie sans si le modèle la refuse', async () => {
    const bodies: string[] = []
    const responses = [
      Response.json(
        { error: { code: 400, message: 'Thinking budget is not supported for this model.' } },
        { status: 400 },
      ),
      ok(),
    ]
    const fetchFn = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body))
      const next = responses.shift()
      if (!next) throw new Error('plus de réponse')
      return next
    }
    const events = await extractEvents(
      { apiKey: 'k', models: ['m1'], fetchFn, thinkingBudget: 0, sleep },
      batch,
    )
    expect(events).toHaveLength(1)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toContain('"thinkingConfig":{"thinkingBudget":0}')
    expect(bodies[1]).not.toContain('thinkingConfig')
  })
})
