/**
 * Serves the built SPA from the same origin as the API (no CORS, simple CSP, same-site cookies).
 * Hashed assets are cached for a year, fonts and icons for a week; everything else, including
 * index.html, is revalidated.
 * Unknown paths that are not API calls get index.html (client-side routing).
 */
import { resolve, sep } from 'node:path'
import { Elysia } from 'elysia'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'public, max-age=0, must-revalidate'
// Fonts and icons keep their names but almost never change: a week saves a request per file on
// every visit, which matters on a slow phone connection.
const WEEK = 'public, max-age=604800'

/** Lets a caller answer some navigations itself (robots get a rendered page): null = not handled. */
export type Intercept = (request: Request) => Promise<Response | null>

export function spa(distDir: string, intercept?: Intercept) {
  const root = resolve(distDir)
  const index = Bun.file(`${root}/index.html`)

  return new Elysia({ name: 'spa' }).get(
    '/*',
    async ({ request, set, status }) => {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith('/api/')) return status(404, 'Not Found')
      const handled = await intercept?.(request)
      if (handled) return handled

      let decoded: string
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        // A malformed escape ("/%E0%A4%A") is the visitor's mistake, not a server error.
        return status(400, 'Bad Request')
      }
      const path = resolve(root, `.${decoded}`)
      if (path !== root && !path.startsWith(root + sep)) return status(404, 'Not Found')

      const file = Bun.file(path)
      if (pathname !== '/' && (await file.exists())) {
        set.headers['cache-control'] = pathname.startsWith('/assets/')
          ? IMMUTABLE
          : pathname.startsWith('/fonts/') || pathname.startsWith('/icons/')
            ? WEEK
            : REVALIDATE
        return file
      }
      // A missing file with an extension is a real 404, not a client route.
      if (/\.[a-z0-9]+$/i.test(pathname)) return status(404, 'Not Found')
      set.headers['cache-control'] = REVALIDATE
      // Robots get another page at the same address (see `intercept`): a shared cache must key on it.
      if (intercept) set.headers.vary = 'user-agent'
      return index
    },
    { detail: { hide: true } },
  )
}
