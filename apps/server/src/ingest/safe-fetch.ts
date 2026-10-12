/**
 * Outbound fetch for everything the pipeline reads from the internet (feeds, article pages, Google
 * News, Telegram, Bluesky, My Maps). The addresses come from the outside world: an RSS item can
 * link anywhere, and a page can answer with a redirect to anywhere. Left alone, a hostile or
 * compromised feed could make the worker call services that only the server can reach (the
 * database host, the container orchestrator, a cloud metadata address) and have the answer
 * analysed and stored. This wrapper:
 *   - allows http(s) only;
 *   - refuses private, loopback, link-local and other non-public addresses, for IP literals and
 *     for the addresses a hostname resolves to;
 *   - follows redirects itself, one hop at a time, and checks every hop (the default `follow`
 *     would check nothing past the first URL), with a cap on the number of hops.
 *
 * Not covered: a DNS answer that changes between this check and the connection (rebinding). The
 * worker should also be denied access to private networks at the network level (see docs/ops).
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { FetchLike } from './types.ts'

export class BlockedUrlError extends Error {
  override name = 'BlockedUrlError'
}

export type Resolver = (hostname: string) => Promise<string[]>

const defaultResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((a) => a.address)

const MAX_REDIRECTS = 5

/** Hostnames that are never public, whatever they resolve to. */
const LOCAL_NAMES = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp)$/i

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every((n) => n <= 255) ? parts : null
}

function isPrivateV4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return true
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || // IETF protocol assignments, documentation
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  )
}

/** True for any address that is not a public unicast address. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase()
  const v4 = ipv4Parts(ip)
  if (v4) return isPrivateV4(v4)
  if (isIP(ip) !== 6) return true // not an address at all: refuse
  if (ip === '::' || ip === '::1') return true
  // IPv4 carried in IPv6 (::ffff:10.0.0.1 or its hex form ::ffff:a00:1).
  const mapped = /^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
  if (mapped?.[1]) return isPrivateAddress(mapped[1])
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip)
  if (hex?.[1] && hex[2]) {
    const hi = Number.parseInt(hex[1], 16)
    const lo = Number.parseInt(hex[2], 16)
    return isPrivateV4([hi >> 8, hi & 255, lo >> 8, lo & 255])
  }
  const first = Number.parseInt(ip.split(':')[0] || '0', 16)
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 // multicast
  )
}

/** Throws `BlockedUrlError` unless the URL may be fetched. */
export async function assertPublicUrl(
  raw: string,
  resolve: Resolver = defaultResolver,
): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedUrlError(`invalid URL: ${raw.slice(0, 120)}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new BlockedUrlError(`scheme not allowed: ${url.protocol}`)
  if (url.username || url.password) throw new BlockedUrlError('credentials in the URL')
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) throw new BlockedUrlError('no host')
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedUrlError(`address not public: ${host}`)
    return url
  }
  // "2130706433" or "0x7f.1" style hosts are normalised to dotted form by URL; anything that is
  // still not a dotted name is a single label (an internal host name).
  if (!host.includes('.') || LOCAL_NAMES.test(host))
    throw new BlockedUrlError(`host not public: ${host}`)
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new BlockedUrlError(`cannot resolve: ${host}`)
  }
  if (addresses.length === 0) throw new BlockedUrlError(`cannot resolve: ${host}`)
  const bad = addresses.find(isPrivateAddress)
  if (bad) throw new BlockedUrlError(`${host} resolves to a non-public address (${bad})`)
  return url
}

/**
 * Wraps a fetch so every request, and every redirect it triggers, is checked. A request that
 * asks for `redirect: 'manual'` or `'error'` is left to the caller after the first check.
 */
export function safeFetch(inner: FetchLike, resolve: Resolver = defaultResolver): FetchLike {
  return async (input, init) => {
    const mode = init?.redirect ?? 'follow'
    let url = (await assertPublicUrl(input, resolve)).toString()
    if (mode !== 'follow') return inner(url, init)
    let method = init?.method
    let body = init?.body
    for (let hop = 0; ; hop++) {
      const res = await inner(url, { ...init, method, body, redirect: 'manual' })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || !location) return res
      await res.body?.cancel()
      if (hop >= MAX_REDIRECTS) throw new BlockedUrlError('too many redirects')
      url = (await assertPublicUrl(new URL(location, url).toString(), resolve)).toString()
      // As browsers do: 301/302/303 turn a POST into a GET.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
      }
    }
  }
}
