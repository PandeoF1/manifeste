/**
 * Serves the built SPA from the same origin as the API (no CORS, simple CSP, same-site cookies).
 * Hashed assets are cached for a year; everything else, including index.html, is revalidated.
 * Unknown paths that are not API calls get index.html (client-side routing).
 */
import { resolve, sep } from 'node:path'
import { Elysia } from 'elysia'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'public, max-age=0, must-revalidate'

export function spa(distDir: string) {
  const root = resolve(distDir)
  const index = Bun.file(`${root}/index.html`)

  return new Elysia({ name: 'spa' }).get(
    '/*',
    async ({ request, set, status }) => {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith('/api/')) return status(404, 'Not Found')

      const path = resolve(root, `.${decodeURIComponent(pathname)}`)
      if (path !== root && !path.startsWith(root + sep)) return status(404, 'Not Found')

      const file = Bun.file(path)
      if (pathname !== '/' && (await file.exists())) {
        set.headers['cache-control'] = pathname.startsWith('/assets/') ? IMMUTABLE : REVALIDATE
        return file
      }
      // A missing file with an extension is a real 404, not a client route.
      if (/\.[a-z0-9]+$/i.test(pathname)) return status(404, 'Not Found')
      set.headers['cache-control'] = REVALIDATE
      return index
    },
    { detail: { hide: true } },
  )
}
