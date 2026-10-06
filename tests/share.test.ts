import { describe, expect, it } from 'vitest'
import { _inject } from '../api/share'
import { escapeHtml, parisTime, plural } from '../api/_data'

const shell = `<!doctype html><html><head>
<title>Ancien</title>
<meta name="description" content="ancienne" />
<meta property="og:title" content="ancien" />
<meta
  property="og:description"
  content="sur plusieurs lignes"
/>
<meta name="twitter:card" content="summary" />
</head><body><div id="root"></div></body></html>`

describe('aperçus de partage', () => {
  it('remplace titre et balises Open Graph sans doublon', () => {
    const html = _inject(shell, {
      title: 'Lycée "Victor" <Hugo> : Bloqué',
      description: 'desc',
      image: 'https://m.fr/api/og?uai=0000002B',
      url: 'https://m.fr/lycee/0000002B',
    })
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html.match(/property="og:title"/g)).toHaveLength(1)
    expect(html.match(/property="og:description"/g)).toHaveLength(1)
    expect(html.match(/name="twitter:card"/g)).toHaveLength(1)
    expect(html).toContain('content="summary_large_image"')
    expect(html).not.toContain('ancien')
    // Échappement : un nom de lycée ne peut pas injecter de HTML.
    expect(html).toContain('Lycée &#34;Victor&#34; &#60;Hugo&#62; : Bloqué')
    expect(html).not.toContain('<Hugo>')
    expect(html).toContain('<div id="root"></div>')
  })

  it('helpers', () => {
    expect(escapeHtml(`<a href="x">'`)).toBe('&#60;a href=&#34;x&#34;&#62;&#39;')
    expect(plural(1, 'lycée bloqué', 'lycées bloqués')).toBe('1 lycée bloqué')
    expect(plural(3, 'lycée bloqué', 'lycées bloqués')).toBe('3 lycées bloqués')
    expect(parisTime('2026-10-05T06:12:00Z')).toBe('08h12')
  })
})

describe('pages pour les moteurs', () => {
  const app = `<html><head><title>x</title></head><body><div id="root">
      <main><h1>Chargement</h1></main>
    </div><!-- /root --></body></html>`

  it('remplace l’écran de chargement par le contenu et ajoute l’adresse canonique', () => {
    const html = _inject(app, {
      title: 't',
      description: 'd',
      image: 'https://m.fr/api/og',
      url: 'https://m.fr/liste',
      body: '<main><h1>Liste</h1></main>',
      jsonLd: { name: '</script><script>alert(1)</script>' },
    })
    expect(html).toContain('<div id="root"><main><h1>Liste</h1></main></div><!-- /root -->')
    expect(html).not.toContain('Chargement')
    expect(html).toContain('<link rel="canonical" href="https://m.fr/liste" />')
    expect(html).not.toContain('</script><script>alert')
  })
})

describe('sitemap', () => {
  it('liste les pages fixes et les lycées', async () => {
    const { buildSitemap } = await import('../api/sitemap')
    const xml = buildSitemap(
      'https://m.fr',
      [{ uai: '0750001A', last_signal_at: '2026-10-06T08:00:00Z' }],
      new Date('2026-10-06T10:00:00Z'),
    )
    expect(xml).toContain('<loc>https://m.fr/</loc>')
    expect(xml).toContain('<loc>https://m.fr/liste</loc>')
    expect(xml).toContain(
      '<loc>https://m.fr/lycee/0750001A</loc><lastmod>2026-10-06T08:00:00Z</lastmod>',
    )
  })
})

describe('robots', () => {
  it('reconnaît moteurs et aperçus, pas les navigateurs', async () => {
    const { isBot } = await import('../api/_bots')
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(
      true,
    )
    expect(isBot('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true)
    expect(isBot('WhatsApp/2.23')).toBe(true)
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe(false)
    expect(isBot(null)).toBe(false)
  })
})

describe('vercel.json', () => {
  it('utilise la même liste de robots que le middleware', async () => {
    const { BOT_UA } = await import('../api/_bots')
    const { readFileSync } = await import('node:fs')
    const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      rewrites: Array<{ has?: Array<{ value: string }> }>
    }
    const values = cfg.rewrites.flatMap((r) => r.has ?? []).map((h) => h.value)
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) expect(v).toBe(`(?i).*(${BOT_UA.source}).*`)
  })
})
