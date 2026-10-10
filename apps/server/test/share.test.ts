import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isShareBot } from '../src/modules/share/bots.ts'
import {
  buildSitemap,
  escapeHtml,
  inject,
  parisTime,
  plural,
  type Meta,
} from '../src/modules/share/html.ts'
import { pageOf } from '../src/modules/share/index.ts'
import { addReport, addSchool } from './seed.ts'
import { startTestServer, type TestServer } from './helpers.ts'

const SHELL = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="description"
      content="old"
    />
    <meta property="og:title" content="old" />
    <title>Old title</title>
    <link rel="canonical" href="https://old.example/" />
    <script type="application/ld+json">{"old":true}</script>
  </head>
  <body><div id="root"><p>Loading…</p></div><!-- /root --></body>
</html>`

describe('pure helpers', () => {
  const meta: Meta = {
    title: 'Lycée "Test" <b>',
    description: 'Une description',
    image: 'https://x.test/api/og',
    url: 'https://x.test/lycee/0590001A',
    body: '<main>content</main>',
    jsonLd: { '@type': 'Dataset', name: '</script><script>alert(1)</script>' },
  }

  test('inject replaces the old tags and the loading screen', () => {
    const html = inject(SHELL, meta)
    expect(html).toContain('<title>Lycée &#34;Test&#34; &#60;b&#62;</title>')
    expect(html).not.toContain('Old title')
    expect(html).not.toContain('content="old"')
    expect(html).not.toContain('old.example')
    expect(html).toContain('<link rel="canonical" href="https://x.test/lycee/0590001A" />')
    expect(html).toContain('<div id="root"><main>content</main></div><!-- /root -->')
    expect(html).toContain('twitter:card')
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  test('JSON-LD can never close the script tag', () => {
    const html = inject(SHELL, meta)
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    expect(ld?.[1]).toContain('\\u003c/script>')
    expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(1)
  })

  test('escaping, plurals and Paris time', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&#60;a href=&#34;x&#34;&#62;&#38;&#39;')
    expect(plural(1, 'département', 'départements')).toBe('1 département')
    expect(plural(3, 'département', 'départements')).toBe('3 départements')
    expect(parisTime(new Date('2026-10-05T12:30:00Z'))).toBe('14h30')
  })

  test('sitemap lists the fixed pages and each signalled school', () => {
    const xml = buildSitemap(
      'https://x.test',
      [{ uai: '0590001A', lastSignalAt: new Date('2026-10-05T10:00:00Z') }],
      new Date('2026-10-06T00:00:00Z'),
    )
    expect(xml).toContain('<loc>https://x.test/</loc>')
    expect(xml).toContain(
      '<loc>https://x.test/lycee/0590001A</loc><lastmod>2026-10-05T10:00:00.000Z</lastmod>',
    )
    expect(xml).toContain('<loc>https://x.test/a-propos</loc><changefreq>monthly</changefreq>')
  })

  test('which user agents are robots, which paths are pages', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Discordbot/2.0)',
      'TelegramBot (like TwitterBot)',
      'Googlebot/2.1',
      'WhatsApp/2.23',
    ])
      expect(isShareBot(ua)).toBe(true)
    expect(isShareBot('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0')).toBe(false)
    expect(isShareBot(null)).toBe(false)
    expect(pageOf('/')).toEqual({ page: 'home' })
    expect(pageOf('/liste')).toEqual({ page: 'list' })
    expect(pageOf('/lycee/0590001A')).toEqual({ page: 'school', uai: '0590001A' })
    for (const bad of ['/lycee/nope', '/admin', '/api/statuses', '/lycee/0590001A/x'])
      expect(pageOf(bad)).toBeNull()
  })
})

describe('served pages', () => {
  let s: TestServer
  let web: string
  let uai: string

  beforeAll(async () => {
    web = mkdtempSync(join(tmpdir(), 'manifeste-web-'))
    writeFileSync(join(web, 'index.html'), SHELL)
    mkdirSync(join(web, 'fonts'))
    cpSync(join(import.meta.dir, '../../web/public/fonts'), join(web, 'fonts'), { recursive: true })
    s = await startTestServer({ WEB_DIST: web, PUBLIC_URL: 'http://localhost:3000' })
    uai = await addSchool(s.ctx.db, { name: 'Lycée Pasteur', city: 'Lille', department: '59' })
    await addReport(s.ctx.db, { schoolUai: uai, status: 'blocked', hoursAgo: 1 })
  })
  afterAll(async () => {
    await s.close()
    rmSync(web, { recursive: true, force: true })
  })

  const asBot = { 'user-agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)' }

  test('humans get the app, robots get the page with its content', async () => {
    const human = await s.request('/lycee/' + uai, {
      headers: { 'user-agent': 'Mozilla/5.0 Firefox/130.0' },
    })
    expect(await human.text()).toContain('Loading…')
    const bot = await (await s.request('/lycee/' + uai, { headers: asBot })).text()
    expect(bot).toContain('<title>Lycée Pasteur (Lille) : bloqué - blocus en direct</title>')
    expect(bot).toContain(`og:image" content="http://localhost:3000/api/og?uai=${uai}"`)
    expect(bot).not.toContain('Loading…')
  })

  test('the home page lists the schools in progress, grouped by department', async () => {
    const bot = await (await s.request('/', { headers: asBot })).text()
    expect(bot).toContain('1 établissement bloqué')
    expect(bot).toContain('<h3>59</h3>')
    expect(bot).toContain(`<a href="/lycee/${uai}">Lycée Pasteur</a>`)
    expect(bot).toContain('"@type":"WebSite"')
  })

  test('the data page carries a Dataset description with export links', async () => {
    const bot = await (await s.request('/donnees', { headers: asBot })).text()
    expect(bot).toContain('"@type":"Dataset"')
    expect(bot).toContain('/api/donnees?vue=jours&#38;format=csv')
  })

  test('an unknown school still answers, with the generic page', async () => {
    const res = await s.request('/lycee/9999999Z', { headers: asBot })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Map et carte des blocus')
  })

  test('the preview image is a 1200 x 630 PNG, for the country and for one school', async () => {
    for (const path of ['/api/og', `/api/og?uai=${uai}`, '/api/og?uai=9999999Z']) {
      const res = await s.request(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(res.headers.get('cache-control')).toContain('s-maxage=300')
      const png = new Uint8Array(await res.arrayBuffer())
      expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const view = new DataView(png.buffer)
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630])
    }
    expect((await s.request('/api/og?uai=bad')).status).toBe(422)
  })

  test('the sitemap lists signalled schools', async () => {
    const res = await s.request('/sitemap.xml')
    expect(res.headers.get('content-type')).toContain('application/xml')
    const xml = await res.text()
    expect(xml).toContain(`http://localhost:3000/lycee/${uai}`)
  })
})
