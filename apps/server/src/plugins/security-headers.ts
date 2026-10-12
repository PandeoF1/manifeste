/**
 * Security headers on every response, and a Content-Security-Policy on the pages.
 *
 * The site loads very little from outside: the map tiles and style (OpenFreeMap) and the
 * Cloudflare Turnstile widget on the report form. Everything else is the site's own origin, so the
 * policy can be strict: no inline script, no framing, no plugins, forms and base URL on the origin.
 * Styles keep 'unsafe-inline' (React sets style attributes, and the loading screen has some).
 *
 * `CSP_MODE=report-only` shows violations in the browser console without blocking (use it to try a
 * new map provider); `off` removes the header.
 */
import { Elysia } from 'elysia'

export type CspMode = 'enforce' | 'report-only' | 'off'

export interface SecurityHeadersOptions {
  /** HSTS only makes sense (and is only safe) over https in production. */
  production: boolean
  csp: CspMode
  /** Origins the map loads its style, tiles, glyphs and sprites from. */
  mapOrigins: readonly string[]
}

/**
 * `embeddable`: the pages under /embed are made to be put in an iframe on other sites (the data
 * page gives the snippet), so they must not forbid framing. Everything else cannot be framed.
 */
export function contentSecurityPolicy(
  mapOrigins: readonly string[],
  options: { embeddable?: boolean } = {},
): string {
  const map = mapOrigins.join(' ')
  const turnstile = 'https://challenges.cloudflare.com'
  return [
    "default-src 'self'",
    `script-src 'self' ${turnstile}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${map}`.trim(),
    `font-src 'self' data: ${map}`.trim(),
    `connect-src 'self' wss: ws: ${map} ${turnstile}`.replace(/\s+/g, ' ').trim(),
    "worker-src 'self' blob:",
    // The data page previews its own /embed pages in frames.
    `frame-src 'self' ${turnstile}`,
    options.embeddable ? 'frame-ancestors *' : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export const securityHeaders = (options: SecurityHeadersOptions) => {
  const csp = contentSecurityPolicy(options.mapOrigins)
  const embedCsp = contentSecurityPolicy(options.mapOrigins, { embeddable: true })
  const cspName =
    options.csp === 'report-only'
      ? 'content-security-policy-report-only'
      : 'content-security-policy'

  const apply = (
    set: (name: string, value: string) => void,
    isDocument: boolean,
    embeddable: boolean,
  ) => {
    set('x-content-type-options', 'nosniff')
    set('referrer-policy', 'strict-origin-when-cross-origin')
    set('permissions-policy', 'camera=(), microphone=(), payment=(), usb=()')
    // Geolocation stays available to this origin: the report form asks for the position.
    if (options.production) set('strict-transport-security', 'max-age=31536000; includeSubDomains')
    if (isDocument && options.csp !== 'off') set(cspName, embeddable ? embedCsp : csp)
  }
  const isHtml = (type: string | null | undefined) => (type ?? '').startsWith('text/html')

  return new Elysia({ name: 'security-headers' }).onAfterHandle(
    { as: 'global' },
    ({ request, response, set }) => {
      const embeddable = /^\/embed(\/|$)/.test(new URL(request.url).pathname)
      const own = response instanceof Response ? response : null
      // A file handed back as is (the app's index.html) is a Blob; its type is on the object.
      const type =
        own?.headers.get('content-type') ?? (response instanceof Blob ? response.type : '') ?? ''
      const declared = type || String(set.headers['content-type'] ?? '')
      apply(
        (name, value) => {
          set.headers[name] = value
          // A handler that built its own Response keeps its headers: put ours on it too.
          if (own && !own.headers.has(name)) {
            try {
              own.headers.set(name, value)
            } catch {
              // immutable headers (a fetched response): the ones in `set` still apply
            }
          }
        },
        isHtml(declared),
        embeddable,
      )
    },
  )
}
