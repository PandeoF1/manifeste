// Plan du site pour les moteurs de recherche : pages fixes et page de chaque lycée signalé
// pendant le mouvement (les plus récents d'abord).
import { escapeHtml, signaledSchools } from './_data'

export const config = { runtime: 'edge' }

const DAY = 86_400_000

export function buildSitemap(
  origin: string,
  schools: Array<{ uai: string; last_signal_at: string }>,
  now = new Date(),
): string {
  const today = now.toISOString()
  const urls = [
    { loc: `${origin}/`, lastmod: today, changefreq: 'always', priority: '1.0' },
    { loc: `${origin}/liste`, lastmod: today, changefreq: 'always', priority: '0.9' },
    { loc: `${origin}/a-propos`, changefreq: 'monthly', priority: '0.3' },
    ...schools.map((s) => ({
      loc: `${origin}/lycee/${s.uai}`,
      lastmod: s.last_signal_at,
      changefreq: 'hourly',
      priority: '0.6',
    })),
  ]
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

export default async function handler(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin
  const schools = await signaledSchools(new Date(Date.now() - 60 * DAY)).catch(() => [])
  return new Response(buildSitemap(origin, schools), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=600',
    },
  })
}
