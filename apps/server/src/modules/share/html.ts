/**
 * The HTML given to robots: the app's own page with a title, description, image, canonical URL
 * and the page content as plain HTML. The wording is French (it is what search engines and
 * link previews show); identifiers and structure are English. Pure functions.
 */
import type { ReportStatus } from '@manifeste/core'

export interface Meta {
  title: string
  description: string
  image: string
  url: string
  /** Page content as HTML, placed in #root before the app loads. */
  body?: string
  jsonLd?: object
}

export type Page = 'home' | 'list' | 'school' | 'data'

export const STATUS_LABEL: Record<ReportStatus, string> = {
  blocked: 'Bloqué',
  filtering: 'Barrage filtrant',
  lifted: 'Blocus levé',
}

export const STATUS_COLOR: Record<ReportStatus, string> = {
  blocked: '#ff453a',
  filtering: '#ff9f0a',
  lifted: '#98a2b3',
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`

const timeFmt = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})
/** "14h30", Paris time. */
export const parisTime = (at: Date): string => timeFmt.format(at).replace(':', 'h')

const SITE_TITLE = 'Map des blocus : lycées et facs bloqués en direct - Manifeste'
const SITE_DESCRIPTION =
  "Map et carte des blocus en direct : les lycées, facs et écoles bloqués ou en barrage filtrant en France, avec la ville, l'heure et la source de chaque information. Mise à jour en continu."

const NAV = `<nav><a href="/">Carte des blocus</a> · <a href="/liste">Liste des établissements bloqués</a> · <a href="/donnees">Les chiffres et les données</a> · <a href="/a-propos">À propos et méthode</a></nav>`

export interface ActiveSchool {
  uai: string
  name: string
  city: string
  department: string | null
  status: ReportStatus
  lastSignalAt: Date
}

export interface NationalSummary {
  /** Schools blocked or filtering at some point since the movement began. */
  total: number
  blocked: number
  filtering: number
  departments: number
}

export interface DataSummary {
  firstDay: string | null
  schools: number
  departments: number
}

/** Current schools grouped by department (the most mobilised first). */
function schoolsHtml(schools: ActiveSchool[]): string {
  const byDepartment = new Map<string, ActiveSchool[]>()
  for (const s of schools) {
    const d = s.department ?? 'Autres'
    byDepartment.set(d, [...(byDepartment.get(d) ?? []), s])
  }
  return [...byDepartment]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'))
    .map(
      ([department, list]) =>
        `<h3>${escapeHtml(department)}</h3><ul>${list
          .map(
            (s) =>
              `<li><a href="/lycee/${escapeHtml(s.uai)}">${escapeHtml(s.name)}</a>, ${escapeHtml(s.city)} : ${STATUS_LABEL[s.status].toLowerCase()} (signalé à ${parisTime(s.lastSignalAt)})</li>`,
          )
          .join('')}</ul>`,
    )
    .join('')
}

export function fallbackMeta(origin: string, page: Page): Meta {
  const url =
    page === 'list' ? `${origin}/liste` : page === 'data' ? `${origin}/donnees` : `${origin}/`
  return {
    title:
      page === 'list'
        ? 'Liste des blocus : lycées et facs bloqués en direct - Manifeste'
        : SITE_TITLE,
    description: SITE_DESCRIPTION,
    image: `${origin}/api/og`,
    url,
    body: `<main><h1>Map et carte des blocus de lycées et de facs en direct</h1><p>${escapeHtml(SITE_DESCRIPTION)}</p>${NAV}</main>`,
  }
}

export function homeMeta(
  origin: string,
  page: 'home' | 'list',
  n: NationalSummary,
  schools: ActiveSchool[],
): Meta {
  const base = fallbackMeta(origin, page)
  const counts = `${plural(n.blocked, 'établissement bloqué', 'établissements bloqués')} et ${n.filtering} en barrage filtrant dans ${plural(n.departments, 'département', 'départements')}`
  const h1 =
    page === 'list'
      ? 'Liste des lycées et facs bloqués en direct'
      : 'Map et carte des blocus de lycées et de facs en direct'
  return {
    ...base,
    title:
      page === 'list'
        ? `Liste des lycées et facs bloqués : ${plural(n.blocked, 'établissement', 'établissements')} en ce moment - Manifeste`
        : `Map des blocus : ${plural(n.total, 'établissement bloqué', 'établissements bloqués')} depuis le début du mouvement (lycées et facs) - Manifeste`,
    description: `Depuis le début du mouvement, ${plural(n.total, 'établissement a été bloqué', 'établissements ont été bloqués')} ou en barrage filtrant. En ce moment, ${counts}. La carte en direct des blocus de lycées et de facs en France, avec la source de chaque information.`,
    body: `<main><h1>${h1}</h1><p>En ce moment : ${escapeHtml(counts)}. Manifeste recense en direct les lycées et les facs bloqués partout en France, à partir de la presse, des réseaux et des signalements, avec la source de chaque information.</p>${NAV}<h2>Établissements bloqués et barrages filtrants en ce moment</h2>${schoolsHtml(schools)}</main>`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Manifeste',
      alternateName: [
        'Carte des blocus de lycées et de facs',
        'Map des blocus',
        'Carte du blocus',
        'Carte des lycées bloqués',
        'Carte des facs bloquées',
        'Blocage de lycée en direct',
        'Blocus lycée en direct',
      ],
      url: `${origin}/`,
      inLanguage: 'fr-FR',
      description: SITE_DESCRIPTION,
    },
  }
}

export interface SchoolSummary {
  uai: string
  name: string
  city: string
  department: string | null
  status: ReportStatus | null
  lastSignalAt: Date | null
}

export function schoolMeta(origin: string, s: SchoolSummary): Meta {
  const status = s.status ? STATUS_LABEL[s.status] : 'Aucun signal en cours'
  const since = s.lastSignalAt ? ` Dernier signal à ${parisTime(s.lastSignalAt)}.` : ''
  const where = `${s.city}${s.department ? ` (${s.department})` : ''}`
  return {
    title: `${s.name} (${s.city}) : ${status.toLowerCase()} - blocus en direct`,
    description: `${s.name} à ${where} : ${status.toLowerCase()}.${since} Blocus et mobilisation suivis en direct, avec les sources.`,
    image: `${origin}/api/og?uai=${encodeURIComponent(s.uai)}`,
    url: `${origin}/lycee/${s.uai}`,
    body: `<main><h1>${escapeHtml(s.name)} (${escapeHtml(s.city)}) : ${escapeHtml(status.toLowerCase())}</h1><p>Statut du blocus au ${escapeHtml(s.name)}, ${escapeHtml(s.city)}${s.department ? `, ${escapeHtml(s.department)}` : ''}.${escapeHtml(since)} Chaque signal est accompagné de sa source.</p>${NAV}</main>`,
  }
}

/** Data page for search engines: figures of the moment, export links, Dataset schema. */
export function dataMeta(origin: string, r: DataSummary): Meta {
  const base = fallbackMeta(origin, 'data')
  const since = r.firstDay ? ` depuis le ${r.firstDay.split('-').reverse().join('/')}` : ''
  const description = `${plural(r.schools, 'établissement signalé', 'établissements signalés')} bloqué${r.schools > 1 ? 's' : ''} ou en barrage filtrant${since}, dans ${plural(r.departments, 'département', 'départements')}. Chiffres jour par jour, par académie et par département, à télécharger en CSV, JSON et GeoJSON, sous licence libre.`
  const exports = [
    ['jours', 'csv', 'Chiffres jour par jour (CSV)'],
    ['departements', 'csv', 'Chiffres par département (CSV)'],
    ['academies', 'csv', 'Chiffres par académie (CSV)'],
    ['etablissements', 'geojson', 'Établissements (GeoJSON)'],
    ['signalements', 'csv', 'Tous les signalements (CSV)'],
  ] as const
  const link = (view: string, format: string) =>
    `${origin}/api/donnees?vue=${view}&format=${format}`
  return {
    ...base,
    title: 'Les chiffres du mouvement lycéen et étudiant : données libres - Manifeste',
    description,
    body: `<main><h1>Les chiffres du mouvement lycéen et étudiant</h1><p>${escapeHtml(description)}</p><h2>Télécharger les données</h2><ul>${exports
      .map(
        ([v, f, label]) => `<li><a href="${escapeHtml(link(v, f))}">${escapeHtml(label)}</a></li>`,
      )
      .join(
        '',
      )}</ul><p>Licence Creative Commons BY 4.0 : réutilisation libre, en citant Manifeste (manifeste.pandeo.fr).</p>${NAV}</main>`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'Établissements bloqués : lycées et facs, mouvement lycéen et étudiant',
      description,
      url: `${origin}/donnees`,
      inLanguage: 'fr-FR',
      isAccessibleForFree: true,
      license: 'https://creativecommons.org/licenses/by/4.0/',
      creator: { '@type': 'Organization', name: 'Manifeste', url: `${origin}/` },
      distribution: exports.map(([v, f]) => ({
        '@type': 'DataDownload',
        encodingFormat: f === 'csv' ? 'text/csv' : 'application/geo+json',
        contentUrl: link(v, f),
      })),
    },
  }
}

/** Puts the page metadata and content into the app's index.html. */
export function inject(html: string, m: Meta): string {
  const tags = [
    `<title>${escapeHtml(m.title)}</title>`,
    `<meta name="description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:site_name" content="Manifeste" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta property="og:title" content="${escapeHtml(m.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(m.url)}" />`,
    `<meta property="og:image" content="${escapeHtml(m.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(m.title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(m.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(m.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(m.image)}" />`,
    `<link rel="canonical" href="${escapeHtml(m.url)}" />`,
    ...(m.jsonLd
      ? [
          // "<" escaped: the JSON can never close the script tag.
          `<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, '\\u003c')}</script>`,
        ]
      : []),
  ].join('\n    ')
  return (
    html
      .replace(/<title>[\s\S]*?<\/title>/, '')
      // \s+: tags may be spread over several lines (index.html formatting).
      .replace(
        /<meta\s+(?:name="description"|property="og:[^"]+"|name="twitter:[^"]+")[\s\S]*?\/>\s*/g,
        '',
      )
      .replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '')
      .replace('</head>', () => `    ${tags}\n  </head>`)
      // The page content replaces the loading screen (replaced when the app mounts).
      .replace(
        /<div id="root">[\s\S]*?<\/div>\s*<!-- \/root -->/,
        () => `<div id="root">${m.body ?? ''}</div><!-- /root -->`,
      )
  )
}

export function buildSitemap(
  origin: string,
  schools: Array<{ uai: string; lastSignalAt: Date }>,
  now = new Date(),
): string {
  const today = now.toISOString()
  const urls = [
    { loc: `${origin}/`, lastmod: today, changefreq: 'always', priority: '1.0' },
    { loc: `${origin}/liste`, lastmod: today, changefreq: 'always', priority: '0.9' },
    { loc: `${origin}/donnees`, lastmod: today, changefreq: 'hourly', priority: '0.8' },
    { loc: `${origin}/a-propos`, lastmod: undefined, changefreq: 'monthly', priority: '0.3' },
    ...schools.map((s) => ({
      loc: `${origin}/lycee/${s.uai}`,
      lastmod: s.lastSignalAt.toISOString(),
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
