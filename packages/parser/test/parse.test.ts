import { describe, expect, test } from 'bun:test'
import { parse } from '../src/index.ts'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const URL_ = 'https://www.example-press.fr/lycee-bloque'

const para = (n: number) =>
  `<p>Les élèves du lycée Pasteur de Lille ont bloqué l'entrée de l'établissement ce matin, paragraphe ${n}, pour protester contre la réforme annoncée.</p>`
const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => para(i + 1)).join('\n')

const page = (head: string, body: string) =>
  `<!doctype html><html lang="fr"><head><title>Titre | Journal</title>${head}</head><body>${body}</body></html>`

describe('content extraction', () => {
  test('takes the <article>, drops navigation, scripts and furniture lines', () => {
    const html = page(
      '',
      `<header><nav><a href="/">Accueil</a><a href="/a">Monde</a></nav></header>
       <article><h1>Blocage à Lille</h1>${paragraphs(4)}
         <p>À lire aussi : un autre article</p><p>Partager sur Facebook</p>
         <script>var x = "ne pas garder"</script></article>
       <footer><p>© Journal, tous droits réservés</p></footer>`,
    )
    const p = parse(html, URL_, { now: NOW })
    expect(p.text).toContain('lycée Pasteur de Lille')
    expect(p.text).not.toContain('Accueil')
    expect(p.text).not.toContain('ne pas garder')
    expect(p.text).not.toContain('À lire aussi')
    expect(p.text).not.toContain('Partager')
    expect(p.text).not.toContain('tous droits')
    expect(p.blocks).toHaveLength(4) // the h1 is the title, not body
    expect(p.lang).toBe('fr')
  })

  test('without <article>, finds the densest block of paragraphs', () => {
    const html = page(
      '',
      `<div class="menu"><a href="/1">Un</a> <a href="/2">Deux</a> <a href="/3">Trois</a></div>
       <div class="content-wrap">${paragraphs(5)}</div>
       <div class="sidebar"><p>Court.</p></div>`,
    )
    const p = parse(html, URL_, { now: NOW })
    expect(p.text).toContain('paragraphe 5')
    expect(p.text).not.toContain('Trois')
    expect(p.blocked).toBeNull()
  })

  test('list items and quotes are kept and flagged by kind', () => {
    const html = page(
      '',
      `<article>${paragraphs(2)}<ul><li>Premier point détaillé de la liste des revendications</li></ul>
       <blockquote>« Nous ne lâcherons rien », a déclaré une élève devant le lycée.</blockquote></article>`,
    )
    const p = parse(html, URL_, { now: NOW })
    expect(p.blocks.some((b) => b.kind === 'list-item')).toBe(true)
    expect(p.blocks.some((b) => b.kind === 'quote')).toBe(true)
    expect(p.text).toContain('- Premier point')
  })

  test('uses the JSON-LD body when the DOM shows barely more', () => {
    const body = Array.from(
      { length: 8 },
      (_, i) => `Paragraphe numéro ${i} du texte complet de l'article.`,
    ).join('\n')
    const ld = JSON.stringify({
      '@type': 'NewsArticle',
      headline: 'Titre LD',
      articleBody: body,
      datePublished: '2026-10-09T08:00:00+02:00',
    })
    const html = page(
      `<script type="application/ld+json">${ld}</script>`,
      '<article><p>Extrait court.</p></article>',
    )
    const p = parse(html, URL_, { now: NOW })
    expect(p.strategy).toBe('json-ld')
    expect(p.text).toContain('Paragraphe numéro 7')
    expect(p.title).toBe('Titre LD')
  })

  test('applies a site rule: body selector and removed furniture', () => {
    const html = page(
      '',
      `<div class="single-body">${paragraphs(3)}<div class="entry-meta">Par la rédaction, mots parasites</div></div>
       <div class="other">${paragraphs(1)}</div>`,
    )
    const p = parse(html, 'https://www.ouest-france.fr/x', { now: NOW })
    expect(p.text).toContain('paragraphe 3')
    expect(p.text).not.toContain('mots parasites')
  })

  test('collapses whitespace and decodes entities', () => {
    const html = page(
      '',
      `<article><p>Les&nbsp;élèves   de   l&#39;école &amp; du collège ont   bloqué l'entrée ce matin avec beaucoup de monde.</p>${paragraphs(2)}</article>`,
    )
    const p = parse(html, URL_, { now: NOW })
    expect(p.text).toContain("Les élèves de l'école & du collège ont bloqué")
  })
})

describe('metadata', () => {
  test('title prefers JSON-LD headline, then og:title, then <title>', () => {
    expect(parse(page('<meta property="og:title" content="OG">', paragraphs(3)), URL_).title).toBe(
      'OG',
    )
    expect(parse(page('', paragraphs(3)), URL_).title).toBe('Titre | Journal')
  })

  test('description and site name', () => {
    const p = parse(
      page(
        '<meta property="og:description" content="Résumé"><meta property="og:site_name" content="Le Journal">',
        paragraphs(3),
      ),
      URL_,
    )
    expect(p.description).toBe('Résumé')
    expect(p.siteName).toBe('Le Journal')
  })
})

describe('publication date', () => {
  const dateOf = (head: string, body = paragraphs(3)) => parse(page(head, body), URL_, { now: NOW })

  test('JSON-LD wins over meta', () => {
    const ld = JSON.stringify({ '@type': 'NewsArticle', datePublished: '2026-10-08T07:00:00Z' })
    const p = dateOf(
      `<script type="application/ld+json">${ld}</script><meta property="article:published_time" content="2026-10-01T00:00:00Z">`,
    )
    expect(p.publishedSource).toBe('json-ld')
    expect(p.publishedAt?.toISOString()).toBe('2026-10-08T07:00:00.000Z')
  })

  test('meta tag, with and without a zone (zoneless means Paris time)', () => {
    expect(
      dateOf('<meta property="article:published_time" content="2026-10-08T07:00:00Z">')
        .publishedSource,
    ).toBe('meta')
    const summer = dateOf('<meta name="date" content="2026-10-08 10:30:00">')
    expect(summer.publishedAt?.toISOString()).toBe('2026-10-08T08:30:00.000Z')
    const winter = dateOf('<meta name="date" content="2026-01-08 10:30:00">')
    expect(winter.publishedAt?.toISOString()).toBe('2026-01-08T09:30:00.000Z')
  })

  test('<time datetime> then a written French date as last resort', () => {
    const t = dateOf(
      '',
      `<article><time datetime="2026-10-07T18:15:00+02:00">hier</time>${paragraphs(3)}</article>`,
    )
    expect(t.publishedSource).toBe('time-element')
    expect(t.publishedAt?.toISOString()).toBe('2026-10-07T16:15:00.000Z')
    const v = dateOf(
      '',
      `<article><p>Publié le 6 octobre 2026 à 09h30</p>${paragraphs(3)}</article>`,
    )
    expect(v.publishedSource).toBe('visible-text')
    expect(v.publishedAt?.toISOString().slice(0, 10)).toBe('2026-10-06')
  })

  test('rejects future dates and placeholders', () => {
    expect(
      dateOf('<meta property="article:published_time" content="2027-01-01T00:00:00Z">').publishedAt,
    ).toBeNull()
    expect(
      dateOf('<meta property="article:published_time" content="1970-01-01T00:00:00Z">').publishedAt,
    ).toBeNull()
  })

  test('no date, no problem', () => {
    const p = dateOf('')
    expect(p.publishedAt).toBeNull()
    expect(p.publishedSource).toBeNull()
  })
})

describe('blocked pages', () => {
  test('a normal article is not blocked', () => {
    expect(parse(page('', `<article>${paragraphs(6)}</article>`), URL_).blocked).toBeNull()
  })

  test('Cloudflare challenge', () => {
    const p = parse(
      `<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div><script src="/cdn-cgi/challenge-platform/h/b"></script></body></html>`,
      URL_,
    )
    expect(p.blocked?.reason).toBe('bot-wall')
  })

  test('access denied and soft 404', () => {
    const titled = (title: string, body: string) => page('', body).replace('Titre | Journal', title)
    expect(parse(titled('Access Denied', '<h1>Access Denied</h1>'), URL_).blocked?.reason).toBe(
      'access-denied',
    )
    expect(
      parse(titled('Page introuvable', '<h1>Oups</h1><p>Page introuvable</p>'), URL_).blocked
        ?.reason,
    ).toBe('not-found')
  })

  test('paywall: JSON-LD flag, or a prompt on a short text', () => {
    const ld = JSON.stringify({ '@type': 'NewsArticle', isAccessibleForFree: false })
    const flagged = page(
      `<script type="application/ld+json">${ld}</script>`,
      `<article>${paragraphs(4)}</article>`,
    )
    expect(parse(flagged, URL_).blocked?.reason).toBe('paywall')
    const txt = parse(
      page('', `<article>${paragraphs(2)}<p>Article réservé aux abonnés</p></article>`),
      URL_,
    )
    expect(txt.blocked?.reason).toBe('paywall')
  })

  test('a page with no text is "empty"', () => {
    expect(parse(page('', '<div id="root"></div>'), URL_).blocked?.reason).toBe('empty')
  })

  test('a long article that mentions cookies is still an article', () => {
    const html = page(
      '',
      `<article>${paragraphs(10)}<p>Ce site utilise des cookies didomi</p></article>`,
    )
    expect(parse(html, URL_).blocked).toBeNull()
  })
})

describe('robustness', () => {
  test('garbage in, a page out', () => {
    for (const html of ['', '<', '<<<>>>', '\u0000\u0001', '<p>unclosed <b>', 'x'.repeat(10_000)]) {
      expect(typeof parse(html, URL_).text).toBe('string')
    }
  })

  test('malformed JSON-LD is ignored', () => {
    const html = page(
      '<script type="application/ld+json">{ not json</script>',
      `<article>${paragraphs(4)}</article>`,
    )
    expect(parse(html, URL_).text).toContain('paragraphe 4')
  })

  test('JSON-LD @graph and array forms are understood', () => {
    const ld = JSON.stringify({
      '@graph': [
        { '@type': 'WebSite' },
        { '@type': ['Article'], headline: 'Dans le graphe', datePublished: '2026-10-05T10:00:00Z' },
      ],
    })
    const html = page(`<script type="application/ld+json">${ld}</script>`, paragraphs(3))
    const p = parse(html, URL_, { now: NOW })
    expect(p.title).toBe('Dans le graphe')
    expect(p.publishedAt?.toISOString()).toBe('2026-10-05T10:00:00.000Z')
  })

  test('is deterministic', () => {
    const html = page('', `<article>${paragraphs(5)}</article>`)
    expect(parse(html, URL_, { now: NOW })).toEqual(parse(html, URL_, { now: NOW }))
  })
})

describe('hostile markup', () => {
  test('a very deeply nested page is parsed, not a crash', () => {
    const depth = 60_000
    const html = `<html><head><title>Profond</title></head><body>${'<div>'.repeat(depth)}<p>${'Les élèves bloquent le lycée. '.repeat(30)}</p>${'</div>'.repeat(depth)}</body></html>`
    // A recursive walk overflows the call stack long before this depth.
    const page = parse(html, 'https://press.example/deep')
    expect(page.title).toBe('Profond')
    expect(page.text).toContain('Les élèves bloquent le lycée')
  })
})
