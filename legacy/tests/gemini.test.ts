import { describe, expect, it } from 'vitest'
import {
  GeminiError,
  createExtractor,
  createGeminiClient,
  extractEvents,
  extractionRequest,
  isBillingBlocked,
  mergeUsage,
  modelsFromEnv,
  textCharsFromEnv,
  thinkingBudgetFromEnv,
  totalUsage,
} from '@shared/gemini.ts'
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

  it('coupe la réflexion quand un budget est demandé, et réessaie sans sur toute erreur 400', async () => {
    const bodies: string[] = []
    const responses = [
      Response.json(
        { error: { code: 400, message: 'Request contains an invalid argument.' } },
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

const withUsage = (prompt: number, out: number, thoughts = 0) => {
  const r = JSON.parse(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"events":[]}' }] } }] }),
  )
  r.usageMetadata = {
    promptTokenCount: prompt,
    candidatesTokenCount: out,
    thoughtsTokenCount: thoughts,
  }
  return Response.json(r)
}

describe('consommation de tokens', () => {
  it('cumule entrée, sortie et réflexion par modèle', async () => {
    const { fetchFn } = fakeFetch([
      withUsage(1000, 100, 50),
      err(503),
      err(503),
      withUsage(2000, 300),
    ])
    const client = createGeminiClient({ apiKey: 'k', models: ['m1', 'm2'], fetchFn, sleep })
    const request = { system: 's', user: 'u', schema: {} }
    await client.generate(request)
    await client.generate(request)
    expect(client.usage).toEqual({
      m1: { calls: 1, promptTokens: 1000, outputTokens: 100, thoughtsTokens: 50 },
      m2: { calls: 1, promptTokens: 2000, outputTokens: 300, thoughtsTokens: 0 },
    })
    expect(totalUsage(client.usage)).toEqual({
      calls: 2,
      promptTokens: 3000,
      outputTokens: 400,
      thoughtsTokens: 50,
    })
    expect(totalUsage(mergeUsage(client.usage, client.usage)).promptTokens).toBe(6000)
  })

  it('tolère une réponse sans usageMetadata', async () => {
    const { fetchFn } = fakeFetch([ok()])
    const client = createGeminiClient({ apiKey: 'k', models: ['m1'], fetchFn, sleep })
    await client.generate({ system: 's', user: 'u', schema: {} })
    expect(client.usage.m1).toEqual({
      calls: 1,
      promptTokens: 0,
      outputTokens: 0,
      thoughtsTokens: 0,
    })
  })
})

describe('crédit épuisé (402)', () => {
  it("s'arrête net : ni nouvelle tentative ni modèle de secours", async () => {
    const { fetchFn, calls } = fakeFetch([err(402), ok()])
    const error = await run(fetchFn).catch((e: unknown) => e)
    expect(calls).toEqual(['m1'])
    expect(isBillingBlocked(error)).toBe(true)
    expect((error as Error).message).toMatch(/crédit épuisé ou plafond de dépense/)
    expect(isBillingBlocked(new GeminiError(503, 'x'))).toBe(false)
  })
})

describe('budget de réflexion', () => {
  it("n'est plus renvoyé à un modèle qui l'a refusé (une seule requête en erreur)", async () => {
    const bodies: string[] = []
    const responses = [err(400), ok(), ok(), ok()]
    const fetchFn = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return responses.shift() as Response
    }
    const client = createGeminiClient({
      apiKey: 'k',
      models: ['m1'],
      fetchFn,
      thinkingBudget: 0,
      sleep,
    })
    const request = { system: 's', user: 'u', schema: {} }
    for (let i = 0; i < 3; i++) await client.generate(request)
    // 1 refus, 1 reprise sans réglage, puis 2 appels directement sans réglage.
    expect(bodies).toHaveLength(4)
    expect(bodies.map((b) => b.includes('thinkingConfig'))).toEqual([true, false, false, false])
  })

  it("lit la variable d'environnement : 0 coupe, -1 ou invalide = réglage du modèle", () => {
    expect(thinkingBudgetFromEnv('0')).toBe(0)
    expect(thinkingBudgetFromEnv('1024')).toBe(1024)
    expect(thinkingBudgetFromEnv('-1')).toBeUndefined()
    expect(thinkingBudgetFromEnv('abc')).toBeUndefined()
    expect(thinkingBudgetFromEnv(undefined)).toBeUndefined()
    expect(thinkingBudgetFromEnv(undefined, 0)).toBe(0)
    expect(thinkingBudgetFromEnv('', 0)).toBe(0)
    expect(thinkingBudgetFromEnv('-1', 0)).toBeUndefined()
  })
})

describe('longueur du texte envoyé', () => {
  const long = { ...item, text: 'x'.repeat(5000) }
  const textOf = (textChars?: number) => {
    const user = extractionRequest([{ id: '0', item: long }], textChars).user
    const payload = JSON.parse(user.slice(user.indexOf('['))) as Array<{ texte: string }>
    return payload[0]?.texte.length
  }
  it('garde 6000 caractères par défaut, ou la limite demandée', () => {
    expect(textOf()).toBe(5000)
    expect(textOf(2000)).toBe(2000)
  })
  it("lit la variable d'environnement (≥ 200)", () => {
    expect(textCharsFromEnv('2000')).toBe(2000)
    expect(textCharsFromEnv('50')).toBeUndefined()
    expect(textCharsFromEnv(undefined)).toBeUndefined()
  })
})
