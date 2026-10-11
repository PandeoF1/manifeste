import { describe, expect, it, vi } from 'vitest'
import { MIN_JUDGE_CHARS, createJevJudge } from '@shared/judge.ts'

const input = {
  school: { name: 'Lycée Victor Hugo', city: 'Besançon' },
  status: 'bloque' as const,
  text: `Au lycée Victor Hugo à Besançon, les élèves bloquent l'entrée. ${'x'.repeat(MIN_JUDGE_CHARS)}`,
  publishedDay: '2026-10-09',
}
const answer = {
  answers: {
    bloque: { noul: 0.83 },
    nature: { choice: 'blocage', probabilities: { blocage: 1 } },
    level: { choice: 'lycee', probabilities: { lycee: 1 } },
  },
}

describe('createJevJudge', () => {
  it('envoie un état centré sur l’établissement, avec le modèle fixé, et lit la réponse', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(answer)))
    const verdict = await createJevJudge({ apiKey: 'k', fetchFn })(input)
    expect(verdict).toMatchObject({
      probability: 0.83,
      nature: 'blocage',
      level: 'lycee',
      model: 'jev-1.13.0',
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('jev-1.13.0')
    expect(body.state).toContain("bloquent l'entrée")
    expect(Object.keys(body.questions)).toEqual(['bloque', 'nature', 'level'])
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k')
  })
  it('ne demande rien pour un texte trop court', async () => {
    const fetchFn = vi.fn()
    expect(await createJevJudge({ apiKey: 'k', fetchFn })({ ...input, text: 'court' })).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('rend null (sans lever) si Jev échoue ou répond mal', async () => {
    expect(
      await createJevJudge({ apiKey: 'k', fetchFn: async () => new Response('', { status: 500 }) })(
        input,
      ),
    ).toBeNull()
    expect(
      await createJevJudge({
        apiKey: 'k',
        fetchFn: async () => {
          throw new Error('réseau')
        },
      })(input),
    ).toBeNull()
    expect(
      await createJevJudge({ apiKey: 'k', fetchFn: async () => new Response('{}') })(input),
    ).toBeNull()
  })
})
