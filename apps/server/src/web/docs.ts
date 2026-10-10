/**
 * Public API documentation at /api/docs (Scalar). Only public routes are listed: staff and
 * auth routes are excluded. The Scalar bundle is served from here, not from a CDN, in line
 * with the site's "no third-party scripts" rule.
 */
import { dirname, join } from 'node:path'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'

type OpenApiOptions = NonNullable<Parameters<typeof openapi>[0]>

const SCALAR_BUNDLE = join(
  dirname(Bun.resolveSync('@scalar/api-reference', import.meta.dir)),
  'browser/standalone.js',
)

export const apiDocs = (version: string) =>
  new Elysia({ name: 'docs' })
    .get(
      '/api/docs/scalar.js',
      ({ set }) => {
        set.headers['cache-control'] = 'public, max-age=86400'
        return Bun.file(SCALAR_BUNDLE)
      },
      { detail: { hide: true } },
    )
    .use(
      openapi({
        path: '/api/docs',
        specPath: '/api/docs/openapi.json',
        // The plugin types every Scalar option as required; only the bundle location is set.
        scalar: { cdn: '/api/docs/scalar.js' } as NonNullable<OpenApiOptions['scalar']>,
        exclude: { tags: ['staff'], paths: [/^\/api\/auth/, /^\/api\/docs/] },
        documentation: {
          info: {
            title: 'Manifeste API',
            version,
            description:
              'Open data on French high schools and universities blocked during the student movement. ' +
              'Data is released under CC BY 4.0: credit "Manifeste (manifeste.pandeo.fr)".',
            license: {
              name: 'CC BY 4.0 (data)',
              url: 'https://creativecommons.org/licenses/by/4.0/',
            },
          },
          tags: [{ name: 'health', description: 'Probes' }],
        },
      }),
    )
