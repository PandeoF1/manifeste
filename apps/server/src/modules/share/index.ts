/**
 * What robots see: the preview image, the sitemap, and the app's pages with their content in
 * HTML (the SPA is served to humans as is; see `sharePage`, called from the SPA plugin).
 */
import { join } from 'node:path'
import { Elysia, t } from 'elysia'
import { isUai } from '@manifeste/core'
import { isShareBot } from './bots.ts'
import {
  buildSitemap,
  dataMeta,
  fallbackMeta,
  homeMeta,
  inject,
  schoolMeta,
  type Meta,
  type Page,
} from './html.ts'
import { renderOg, type OgAssets, type OgContent } from './og.ts'
import type { ShareService } from './service.ts'
import { bytesResponse } from '../../lib/response.ts'

/** Which page a path is, for robots; null for anything else (assets, API, unknown). */
export function pageOf(pathname: string): { page: Page; uai?: string } | null {
  if (pathname === '/') return { page: 'home' }
  if (pathname === '/liste') return { page: 'list' }
  if (pathname === '/donnees') return { page: 'data' }
  const school = /^\/lycee\/([^/]+)$/.exec(pathname)
  return school?.[1] && isUai(school[1]) ? { page: 'school', uai: school[1] } : null
}

async function buildMeta(
  origin: string,
  service: ShareService,
  target: ReturnType<typeof pageOf>,
): Promise<Meta> {
  if (!target) return fallbackMeta(origin, 'home')
  const fallback = fallbackMeta(origin, target.page)
  try {
    if (target.page === 'data') return dataMeta(origin, await service.dataSummary())
    if (target.page === 'school' && target.uai) {
      const school = await service.school(target.uai)
      return school ? schoolMeta(origin, school) : fallback
    }
    const [national, active] = await Promise.all([service.national(), service.active()])
    return homeMeta(origin, target.page === 'list' ? 'list' : 'home', national, active)
  } catch {
    return fallback
  }
}

/** The page for a robot, or null when the request is not for one (humans get the SPA). */
export async function sharePage(
  request: Request,
  service: ShareService,
  origin: string,
  webDist: string,
): Promise<Response | null> {
  if (request.method !== 'GET' || !isShareBot(request.headers.get('user-agent'))) return null
  const target = pageOf(new URL(request.url).pathname)
  if (!target) return null
  const [shell, meta] = await Promise.all([
    Bun.file(join(webDist, 'index.html')).text(),
    buildMeta(origin, service, target),
  ])
  return new Response(inject(shell, meta), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  })
}

export const shareModule = (service: ShareService, origin: string, assets: OgAssets) =>
  new Elysia({ name: 'module.share' })
    .get(
      '/api/og',
      async ({ query, set }) => {
        let content: OgContent
        try {
          if (query.uai) {
            const summary = await service.school(query.uai)
            content = summary ? { kind: 'school', summary } : { kind: 'not-found' }
          } else {
            content = { kind: 'national', summary: await service.national() }
          }
        } catch {
          content = { kind: 'generic' }
        }
        // Refreshed every 5 min at the CDN; messaging apps keep their own cache.
        set.headers['cache-control'] =
          'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
        set.headers['content-type'] = 'image/png'
        return bytesResponse(await renderOg(content, assets), {})
      },
      {
        query: t.Object({ uai: t.Optional(t.String({ pattern: '^[0-9]{7}[A-Z]$' })) }),
        detail: {
          tags: ['share'],
          summary: 'Preview image (1200x630): national figures, or one school with ?uai=',
        },
      },
    )
    .get(
      '/sitemap.xml',
      async ({ set }) => {
        // Schools with a signal over the movement; none if the data is unavailable.
        const schools = await service.signaled().catch(() => [])
        set.headers['content-type'] = 'application/xml; charset=utf-8'
        set.headers['cache-control'] = 'public, max-age=600, s-maxage=600'
        return buildSitemap(origin, schools)
      },
      { detail: { hide: true } },
    )
