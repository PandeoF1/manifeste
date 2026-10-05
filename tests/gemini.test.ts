import { describe, expect, it } from 'vitest'
import { extractEvents, modelsFromEnv } from '@shared/gemini.ts'
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
  Response.json(
    { error: { code: status, message: 'This model is currently experiencing high demand.' } },
    { status },
  )

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

describe('extractEvents : résistance aux erreurs Gemini', () => {
  it('réessaie le même modèle après un 503', async () => {
    const { fetchFn, calls } = fakeFetch([err(503), ok()])
    const events = await extractEvents({ apiKey: 'k', models: ['m1', 'm2'], fetchFn, sleep }, batch)
    expect(events).toHaveLength(1)
    expect(calls).toEqual(['m1', 'm1'])
  })

  it('bascule sur le modèle de secours si le principal reste saturé', async () => {
    const { fetchFn, calls } = fakeFetch([err(503), err(503), ok()])
    const events = await extractEvents({ apiKey: 'k', models: ['m1', 'm2'], fetchFn, sleep }, batch)
    expect(events).toHaveLength(1)
    expect(calls).toEqual(['m1', 'm1', 'm2'])
  })

  it('remonte un message lisible si tous les modèles échouent', async () => {
    const { fetchFn } = fakeFetch([err(503), err(503), err(429), err(429)])
    await expect(
      extractEvents({ apiKey: 'k', models: ['m1', 'm2'], fetchFn, sleep }, batch),
    ).rejects.toThrow(
      /Gemini indisponible \(m1, m2\)\. m2 HTTP 429 : This model is currently experiencing high demand\./,
    )
  })

  it("n'insiste pas sur une erreur définitive (clé invalide)", async () => {
    const { fetchFn, calls } = fakeFetch([err(400), ok()])
    await expect(
      extractEvents({ apiKey: 'k', models: ['m1', 'm2'], fetchFn, sleep }, batch),
    ).rejects.toThrow(/HTTP 400/)
    expect(calls).toEqual(['m1'])
  })

  it('construit la liste des modèles depuis l’environnement', () => {
    expect(modelsFromEnv(undefined, undefined)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-2.5-flash',
    ])
    expect(modelsFromEnv('gemini-3.6-flash', undefined)).toEqual([
      'gemini-3.6-flash',
      'gemini-2.5-flash',
    ])
    expect(modelsFromEnv('a', 'b, c,,a')).toEqual(['a', 'b', 'c'])
    expect(modelsFromEnv('a', '')).toEqual(['a'])
  })
})
