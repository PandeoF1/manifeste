// Page servie aux robots d'aperçu (Discord, Telegram, WhatsApp, X, Facebook, Slack...) :
// même HTML que l'app, avec titre, description et image adaptés à la page partagée.
// Les visiteurs humains ne passent jamais ici (voir les réécritures de vercel.json).
import { escapeHtml, nationalSummary, plural, schoolSummary, STATUS_LABEL } from './_data'

export const config = { runtime: 'edge' }

interface Meta {
  title: string
  description: string
  image: string
  url: string
}

async function buildMeta(origin: string, uai: string | null): Promise<Meta> {
  const fallback: Meta = {
    title: 'Manifest - les lycées mobilisés, en direct',
    description:
      'Partout en France, les lycéens se font entendre. La carte en direct des lycées bloqués.',
    image: `${origin}/api/og`,
    url: `${origin}/`,
  }
  try {
    if (uai) {
      const s = await schoolSummary(uai)
      if (!s) return fallback
      const status = s.status ? STATUS_LABEL[s.status] : 'Aucun signal en cours'
      return {
        title: `${s.name} (${s.city}) : ${status}`,
        description: `${status} au ${s.name}, ${s.city}. Suis la mobilisation des lycées en direct sur Manifest.`,
        image: `${origin}/api/og?uai=${encodeURIComponent(s.uai)}`,
        url: `${origin}/lycee/${s.uai}`,
      }
    }
    const n = await nationalSummary()
    return {
      ...fallback,
      title: `${plural(n.bloque, 'lycée bloqué', 'lycées bloqués')} en ce moment - Manifest`,
      description: `${n.filtrant} en barrage filtrant, dans ${plural(n.departments, 'département', 'départements')}. Partout en France, les lycéens se font entendre.`,
    }
  } catch {
    return fallback
  }
}

function inject(html: string, m: Meta): string {
  const tags = [
    `<title>${escapeHtml(m.title)}</title>`,
    `<meta name="description" content="${escapeHtml(m.description)}" />`,
    `<meta property="og:site_name" content="Manifest" />`,
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
  ].join('\n    ')
  return (
    html
      .replace(/<title>[\s\S]*?<\/title>/, '')
      // \s+ : les balises peuvent être réparties sur plusieurs lignes (formatage de index.html).
      .replace(
        /<meta\s+(?:name="description"|property="og:[^"]+"|name="twitter:[^"]+")[\s\S]*?\/>\s*/g,
        '',
      )
      .replace('</head>', `    ${tags}\n  </head>`)
  )
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const uai = url.searchParams.get('uai')
  const [shell, meta] = await Promise.all([
    fetch(`${url.origin}/index.html`).then((r) => r.text()),
    buildMeta(url.origin, uai),
  ])
  return new Response(inject(shell, meta), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300',
    },
  })
}

export { inject as _inject }
