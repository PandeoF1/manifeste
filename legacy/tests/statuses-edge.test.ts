import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../api/statuses'

afterEach(() => vi.unstubAllGlobals())

describe('/api/statuses', () => {
  it('renvoie la liste avec un cache de 30 s au CDN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ uai: '0000001A', status: 'bloque' }]))),
    )
    const res = await handler()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ uai: '0000001A', status: 'bloque' }])
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=30/)
  })

  it('ne met jamais une erreur en cache (l’appli retombe sur la base)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    const res = await handler()
    expect(res.status).toBe(502)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
