# @manifeste/parser

Turns a press article's HTML into clean text, a title, a publication date and a verdict on
whether the page is really the article. **Pure**: no network, no clock (pass `now` to reject
future dates). Used by the ingestion pipeline's "fetch & normalise" stage.

```ts
import { parse } from '@manifeste/parser'

const page = parse(html, url)
page.text // the article, one block per line ("- " prefix for list items)
page.title // JSON-LD headline, else og:title, else <title>
page.publishedAt // Date | null, and page.publishedSource says how we know
page.blocked // null for an article; else { reason, evidence }
page.strategy // how the text was found: json-ld | site-rule | article | scored | body
```

## How it works

1. **Parse** with htmlparser2 (a small, tolerant, allocation-light tree).
2. **JSON-LD** (`NewsArticle`, `@graph`, arrays): headline, dates, body, paywall flag.
3. **Content**: the site rule's `body` selectors if the host has one, else `<article>`, else the
   block of paragraphs with the best text-to-link score; furniture is removed by site rules and a
   short-line lexicon (`boilerplate.ts`) that never touches long sentences.
4. **Body choice**: the JSON-LD body wins when it is ≥ 400 chars and nearly as long as the DOM text.
5. **Date**: JSON-LD, then meta tags, then `<time>`, then a written French date. Zoneless times
   are Paris time; placeholders and future dates are rejected.
6. **Blocked**: challenge pages, captcha, access denied, soft 404, consent walls, empty pages and
   paywalls, only when the text is short enough for the page to be a stand-in.

Site rules (`src/rules.ts`) are data. A rule must earn its place: add it only with a benchmark
run (see `bench/README.md`) showing it helps.

## Selectors

`src/selector.ts` is a deliberately tiny matcher (tag, `#id`, `.class`, `[attr]`, `=`, `^=`, `*=`,
the `i` flag, comma lists, no combinators). It replaces css-select, whose selector lists crashed
the Bun 1.4 JavaScriptCore JIT on some real pages, and linkedom, which crashed it too.

## Runtime note

On Bun 1.4.2 and 1.4.3, DOM-heavy loops with linkedom (and css-select lists) segfaulted. This
package avoids both and ran the whole 1,951-page corpus repeatedly without a crash. If a crash
ever returns, the parser is pure and can run under Node unchanged; calling `Bun.gc(true)`
every few hundred pages was also enough in testing.
