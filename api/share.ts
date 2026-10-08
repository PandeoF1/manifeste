// Page servie aux robots (aperçus de partage : Discord, Telegram, WhatsApp, X... ; moteurs de
// recherche : Google, Bing, Qwant...) : même HTML que l'app, avec titre, description, image et
// adresse canonique de la page, et le contenu de la page en HTML (lycées en cours, liens) pour
// les moteurs. Les visiteurs humains ne passent jamais ici (voir les réécritures de vercel.json).
import {
  activeSchools,
  escapeHtml,
  nationalSummary,
  openData,
  parisTime,
  plural,
  schoolSummary,
  STATUS_LABEL,
  type ActiveSchool,
} from './_data'

export const config = { runtime: 'edge' }

interface Meta {
  title: string
  description: string
  image: string
  url: string
  /** Contenu HTML de la page (pour les moteurs), placé dans #root avant le chargement de l'app. */
  body?: string
  jsonLd?: object
}

export type Page = 'home' | 'liste' | 'lycee' | 'donnees'

const SITE_TITLE = 'Map des blocus : lycées et facs bloqués en direct - Manifeste'
const SITE_DESCRIPTION =
  "Map et carte des blocus en direct : les lycées, facs et écoles bloqués ou en barrage filtrant en France, avec la ville, l'heure et la source de chaque information. Mise à jour en continu."

/** Établissements en cours, groupés par département (le plus mobilisé d'abord). */
function schoolsHtml(schools: ActiveSchool[]): string {
  const byDept = new Map<string, ActiveSchool[]>()
  for (const s of schools) {
    const d = s.department ?? 'Autres'
    byDept.set(d, [...(byDept.get(d) ?? []), s])
  }
  return [...byDept]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'))
    .map(
      ([dept, list]) =>
        `<h3>${escapeHtml(dept)}</h3><ul>${list
          .map(
            (s) =>
              `<li><a href="/lycee/${escapeHtml(s.uai)}">${escapeHtml(s.name)}</a>, ${escapeHtml(s.city)} : ${STATUS_LABEL[s.status].toLowerCase()} (signalé à ${parisTime(s.last_signal_at)})</li>`,
          )
          .join('')}</ul>`,
    )
    .join('')
}

const NAV = `<nav><a href="/">Carte des blocus</a> · <a href="/liste">Liste des établissements bloqués</a> · <a href="/donnees">Les chiffres et les données</a> · <a href="/a-propos">À propos et méthode</a></nav>`

interface ResumeDonnees {
  premier_jour: string | null
  signalements: number
  etablissements: number
  departements: number
  facs: number
}

/** Page « Données » pour les moteurs : chiffres du moment, liens d'export, schéma Dataset. */
async function donneesMeta(origin: string, fallback: Meta): Promise<Meta> {
  const r = (await openData('resume')) as ResumeDonnees
  const depuis = r.premier_jour ? ` depuis le ${r.premier_jour.split('-').reverse().join('/')}` : ''
  const description = `${plural(r.etablissements, 'établissement signalé', 'établissements signalés')} bloqué${r.etablissements > 1 ? 's' : ''} ou en barrage filtrant${depuis}, dans ${plural(r.departements, 'département', 'départements')}. Chiffres jour par jour, par académie et par département, à télécharger en CSV, JSON et GeoJSON, sous licence libre.`
  const exports = [
    ['jours', 'csv', 'Chiffres jour par jour (CSV)'],
    ['departements', 'csv', 'Chiffres par département (CSV)'],
    ['academies', 'csv', 'Chiffres par académie (CSV)'],
    ['etablissements', 'geojson', 'Établissements (GeoJSON)'],
    ['signalements', 'csv', 'Tous les signalements (CSV)'],
  ] as const
  const link = (vue: string, format: string) => `${origin}/api/donnees?vue=${vue}&format=${format}`
  return {
    ...fallback,
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

async function buildMeta(origin: string, page: Page, uai: string | null): Promise<Meta> {
  const url =
    page === 'liste' ? `${origin}/liste` : page === 'donnees' ? `${origin}/donnees` : `${origin}/`
  const fallback: Meta = {
    title:
      page === 'liste'
        ? 'Liste des blocus : lycées et facs bloqués en direct - Manifeste'
        : SITE_TITLE,
    description: SITE_DESCRIPTION,
    image: `${origin}/api/og`,
    url,
    body: `<main><h1>Map et carte des blocus de lycées et de facs en direct</h1><p>${escapeHtml(SITE_DESCRIPTION)}</p>${NAV}</main>`,
  }
  try {
    if (page === 'donnees') return await donneesMeta(origin, fallback)
    if (page === 'lycee' && uai) {
      const s = await schoolSummary(uai)
      if (!s) return fallback
      const status = s.status ? STATUS_LABEL[s.status] : 'Aucun signal en cours'
      const since = s.last_signal_at ? ` Dernier signal à ${parisTime(s.last_signal_at)}.` : ''
      return {
        title: `${s.name} (${s.city}) : ${status.toLowerCase()} - blocus en direct`,
        description: `${s.name} à ${s.city}${s.department ? ` (${s.department})` : ''} : ${status.toLowerCase()}.${since} Blocus et mobilisation suivis en direct, avec les sources.`,
        image: `${origin}/api/og?uai=${encodeURIComponent(s.uai)}`,
        url: `${origin}/lycee/${s.uai}`,
        body: `<main><h1>${escapeHtml(s.name)} (${escapeHtml(s.city)}) : ${escapeHtml(status.toLowerCase())}</h1><p>Statut du blocus au ${escapeHtml(s.name)}, ${escapeHtml(s.city)}${s.department ? `, ${escapeHtml(s.department)}` : ''}.${escapeHtml(since)} Chaque signal est accompagné de sa source.</p>${NAV}</main>`,
      }
    }
    const [n, schools] = await Promise.all([nationalSummary(), activeSchools()])
    const counts = `${plural(n.bloque, 'établissement bloqué', 'établissements bloqués')} et ${n.filtrant} en barrage filtrant dans ${plural(n.departments, 'département', 'départements')}`
    const h1 =
      page === 'liste'
        ? 'Liste des lycées et facs bloqués en direct'
        : 'Map et carte des blocus de lycées et de facs en direct'
    return {
      ...fallback,
      title:
        page === 'liste'
          ? `Liste des lycées et facs bloqués : ${plural(n.bloque, 'établissement', 'établissements')} en ce moment - Manifeste`
          : `Map des blocus : ${plural(n.bloque, 'établissement bloqué', 'établissements bloqués')} en direct (lycées et facs) - Manifeste`,
      description: `En ce moment, ${counts}. La carte en direct des blocus de lycées et de facs en France, avec la source de chaque information.`,
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
  } catch {
    return fallback
  }
}

function inject(html: string, m: Meta): string {
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
          // « < » échappé : le JSON ne peut pas fermer la balise script.
          `<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, '\\u003c')}</script>`,
        ]
      : []),
  ].join('\n    ')
  return (
    html
      .replace(/<title>[\s\S]*?<\/title>/, '')
      // \s+ : les balises peuvent être réparties sur plusieurs lignes (formatage de index.html).
      .replace(
        /<meta\s+(?:name="description"|property="og:[^"]+"|name="twitter:[^"]+")[\s\S]*?\/>\s*/g,
        '',
      )
      .replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '')
      .replace('</head>', `    ${tags}\n  </head>`)
      // Contenu de la page à la place de l'écran de chargement (remplacé au montage de l'app).
      .replace(
        /<div id="root">[\s\S]*?<\/div>\s*<!-- \/root -->/,
        `<div id="root">${m.body ?? ''}</div><!-- /root -->`,
      )
  )
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const uai = url.searchParams.get('uai')
  const pageParam = url.searchParams.get('page')
  const page: Page = uai
    ? 'lycee'
    : pageParam === 'liste'
      ? 'liste'
      : pageParam === 'donnees'
        ? 'donnees'
        : 'home'
  const [shell, meta] = await Promise.all([
    fetch(`${url.origin}/index.html`).then((r) => r.text()),
    buildMeta(url.origin, page, uai),
  ])
  return new Response(inject(shell, meta), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  })
}

export { inject as _inject }
