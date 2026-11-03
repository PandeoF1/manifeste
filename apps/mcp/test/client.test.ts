import { describe, expect, test } from 'bun:test'
import { decideAll, filterPending, MAX_BATCH, StaffClient, type Pending } from '../src/client.ts'

const row = (over: Partial<Pending>): Pending => ({
  id: crypto.randomUUID(),
  schoolUai: '0750001A',
  schoolName: 'Lycée Test',
  schoolCity: 'Paris',
  status: 'blocked',
  origin: 'collected',
  observedAt: '2026-11-01T10:00:00.000Z',
  sourceUrl: null,
  sourceDomain: null,
  certainty: null,
  judge: null,
  tier: null,
  ...over,
})

describe('filterPending', () => {
  const rows = [
    row({ judge: { probability: 0.95, nature: 'blocage' } }),
    row({ judge: { probability: 0.4, nature: 'blocage' } }),
    row({ origin: 'on_site', schoolCity: 'Lyon' }),
  ]

  test('keeps only reports at or above the probability floor, unjudged ones excluded', () => {
    expect(filterPending(rows, { minProbability: 0.9 })).toHaveLength(1)
  })
  test('filters by origin and city, and caps the result', () => {
    expect(filterPending(rows, { origin: 'on_site' })).toHaveLength(1)
    expect(filterPending(rows, { city: 'lyo' })).toHaveLength(1)
    expect(filterPending(rows, { limit: 2 })).toHaveLength(2)
  })
})

describe('decideAll', () => {
  test('decides each report once and refuses an oversized batch', async () => {
    const seen: string[] = []
    const client = {
      decide: async (id: string) => {
        seen.push(id)
        return { id, ok: true, detail: 'approved' }
      },
    }
    const out = await decideAll(client, ['a', 'a', 'b'], 'approve')
    expect(seen).toEqual(['a', 'b'])
    expect(out).toHaveLength(2)
    const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => String(i))
    await expect(decideAll(client, many, 'approve')).rejects.toThrow('At most')
  })
})

describe('StaffClient', () => {
  const login = () =>
    new Response('{}', {
      headers: { 'set-cookie': 'manifeste.session_token=abc; Path=/; HttpOnly' },
    })

  test('signs in, sends the cookie, and signs in again after a 401', async () => {
    const calls: string[] = []
    let expired = true
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      calls.push(u.replace('https://x.test', ''))
      if (u.endsWith('/sign-in/email')) return login()
      expect(new Headers(init?.headers).get('cookie')).toBe('manifeste.session_token=abc')
      if (expired) {
        expired = false
        return new Response('Unauthorized', { status: 401 })
      }
      return Response.json([])
    }) as typeof fetch
    const client = new StaffClient({
      baseUrl: 'https://x.test/',
      email: 'm@x',
      password: 'p',
      fetch: fake,
    })
    expect(await client.pending()).toEqual([])
    expect(calls).toEqual([
      '/api/auth/sign-in/email',
      '/api/staff/reports/pending',
      '/api/auth/sign-in/email',
      '/api/staff/reports/pending',
    ])
  })

  test('reports a refused decision with the server message', async () => {
    const fake = (async (url: string | URL | Request) =>
      String(url).endsWith('/sign-in/email')
        ? login()
        : new Response('This report was already decided', { status: 409 })) as typeof fetch
    const client = new StaffClient({
      baseUrl: 'https://x.test',
      email: 'm@x',
      password: 'p',
      fetch: fake,
    })
    const out = await client.decide('id1', 'approve')
    expect(out.ok).toBe(false)
    expect(out.detail).toContain('409')
  })

  test('refuses an account that needs a 2FA code', async () => {
    const fake = (async () => Response.json({ twoFactorRedirect: true })) as unknown as typeof fetch
    const client = new StaffClient({
      baseUrl: 'https://x.test',
      email: 'a@x',
      password: 'p',
      fetch: fake,
    })
    await expect(client.pending()).rejects.toThrow('2FA')
  })
})
