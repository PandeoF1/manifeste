import { describe, expect, test } from 'bun:test'
import {
  assertPublicUrl,
  BlockedUrlError,
  isPrivateAddress,
  safeFetch,
  type Resolver,
} from '../../src/ingest/safe-fetch.ts'
import { rssAdapter } from '../../src/ingest/adapters/rss.ts'

/** A resolver with a tiny fake DNS. */
const dns =
  (table: Record<string, string[]>): Resolver =>
  async (host) => {
    const found = table[host]
    if (!found) throw new Error('NXDOMAIN')
    return found
  }
const PUBLIC = dns({ 'press.example': ['93.184.216.34'], 'cdn.example': ['151.101.1.1'] })

describe('isPrivateAddress', () => {
  test.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '[::1]',
    'not-an-ip',
  ])('%s is not public', (ip) => expect(isPrivateAddress(ip)).toBe(true))

  test.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  )
})

describe('assertPublicUrl', () => {
  const refused = async (url: string, resolve: Resolver = PUBLIC) =>
    assertPublicUrl(url, resolve).then(
      () => null,
      (e: unknown) => (e instanceof BlockedUrlError ? e.message : 'unexpected'),
    )

  test('lets a public https page through', async () => {
    expect((await assertPublicUrl('https://press.example/a', PUBLIC)).hostname).toBe(
      'press.example',
    )
  })
  test('refuses other schemes and credentials', async () => {
    expect(await refused('file:///etc/passwd')).toContain('scheme')
    expect(await refused('ftp://press.example/x')).toContain('scheme')
    expect(await refused('https://user:pw@press.example/')).toContain('credentials')
    expect(await refused('not a url')).toContain('invalid')
  })
  test('refuses IP literals in every spelling', async () => {
    expect(await refused('http://127.0.0.1/')).toContain('not public')
    expect(await refused('http://169.254.169.254/latest/meta-data')).toContain('not public')
    expect(await refused('http://[::1]:5432/')).toContain('not public')
    // The URL parser turns these into 127.0.0.1.
    expect(await refused('http://2130706433/')).toContain('not public')
    expect(await refused('http://0x7f.1/')).toContain('not public')
    expect(await refused('http://[::ffff:127.0.0.1]/')).toContain('not public')
  })
  test('refuses internal names', async () => {
    expect(await refused('http://localhost:3000/')).toContain('not public')
    expect(await refused('http://db/')).toContain('not public')
    expect(await refused('https://coolify.internal/')).toContain('not public')
    expect(await refused('https://printer.local/')).toContain('not public')
  })
  test('refuses a name that resolves to a private address, or does not resolve', async () => {
    const evil = dns({
      'evil.example': ['93.184.216.34', '10.0.0.5'],
      'meta.example': ['169.254.169.254'],
    })
    expect(await refused('https://evil.example/', evil)).toContain('non-public')
    expect(await refused('https://meta.example/', evil)).toContain('non-public')
    expect(await refused('https://nowhere.example/', evil)).toContain('cannot resolve')
  })
})

describe('safeFetch', () => {
  const redirect = (to: string, status = 302) =>
    new Response(null, { status, headers: { location: to } })

  test('passes a normal request through, with manual redirects', async () => {
    const seen: Array<{ url: string; redirect?: string }> = []
    const f = safeFetch(async (url, init) => {
      seen.push({ url, redirect: init?.redirect })
      return new Response('ok')
    }, PUBLIC)
    expect(await (await f('https://press.example/a')).text()).toBe('ok')
    expect(seen).toEqual([{ url: 'https://press.example/a', redirect: 'manual' }])
  })

  test('follows public redirects, relative ones included', async () => {
    const urls: string[] = []
    const f = safeFetch(async (url) => {
      urls.push(url)
      if (url.endsWith('/a')) return redirect('/b')
      if (url.endsWith('/b')) return redirect('https://cdn.example/c')
      return new Response('end')
    }, PUBLIC)
    expect(await (await f('https://press.example/a')).text()).toBe('end')
    expect(urls).toEqual([
      'https://press.example/a',
      'https://press.example/b',
      'https://cdn.example/c',
    ])
  })

  test('refuses a redirect to an internal address, and never calls it', async () => {
    const urls: string[] = []
    const f = safeFetch(async (url) => {
      urls.push(url)
      return redirect('http://169.254.169.254/latest/meta-data/iam')
    }, PUBLIC)
    await expect(f('https://press.example/a')).rejects.toThrow(BlockedUrlError)
    expect(urls).toEqual(['https://press.example/a'])
  })

  test('refuses a redirect to a name that resolves privately', async () => {
    const table = dns({ 'press.example': ['93.184.216.34'], 'rebind.example': ['192.168.0.10'] })
    const f = safeFetch(async () => redirect('https://rebind.example/x'), table)
    await expect(f('https://press.example/a')).rejects.toThrow('non-public')
  })

  test('gives up on a redirect loop', async () => {
    const f = safeFetch(async () => redirect('https://press.example/again'), PUBLIC)
    await expect(f('https://press.example/a')).rejects.toThrow('too many redirects')
  })

  test('a redirected POST becomes a GET without a body', async () => {
    const calls: Array<{ method?: string; body?: unknown }> = []
    const f = safeFetch(async (_url, init) => {
      calls.push({ method: init?.method, body: init?.body })
      return calls.length === 1 ? redirect('https://press.example/done', 303) : new Response('ok')
    }, PUBLIC)
    await f('https://press.example/a', { method: 'POST', body: 'x=1' })
    expect(calls[1]).toEqual({ method: 'GET', body: undefined })
  })

  test('refuses the first URL too', async () => {
    let called = false
    const f = safeFetch(async () => {
      called = true
      return new Response('x')
    }, PUBLIC)
    await expect(f('http://10.0.0.1/admin')).rejects.toThrow(BlockedUrlError)
    expect(called).toBe(false)
  })
})

describe('adding a feed', () => {
  test('refuses internal feed addresses, accepts public ones', () => {
    expect(() => rssAdapter.normalize('https://localhost/feed')).toThrow('public host')
    expect(() => rssAdapter.normalize('https://10.0.0.5/feed')).toThrow('public host')
    expect(() => rssAdapter.normalize('https://db/feed')).toThrow('public host')
    expect(rssAdapter.normalize('https://www.lemonde.fr/rss/une.xml')).toBe(
      'https://www.lemonde.fr/rss/une.xml',
    )
  })
})
