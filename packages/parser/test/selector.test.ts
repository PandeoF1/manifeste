import { describe, expect, test } from 'bun:test'
import { $, $$, loadDocument } from '../src/dom.ts'

const doc = loadDocument(`<html><body>
  <main id="m" class="page wide"><article data-kind="News story"><p class="lead">One</p><p>Two</p></article></main>
  <div role="main" class="x-post-body">Role</div>
  <a href="https://a.example/x">A</a><a href="/b">B</a>
</body></html>`)

describe('selector matcher', () => {
  test('tag, id, class and attribute forms', () => {
    expect($$('p', doc)).toHaveLength(2)
    expect($('#m', doc)?.name).toBe('main')
    expect($$('.page', doc)).toHaveLength(1)
    expect($$('p.lead', doc)).toHaveLength(1)
    expect($$('[role="main"]', doc)).toHaveLength(1)
    expect($$('[data-kind]', doc)).toHaveLength(1)
  })

  test('attribute operators: prefix, substring and case-insensitive flag', () => {
    expect($$('a[href^="https://"]', doc)).toHaveLength(1)
    expect($$('[class*="post-body"]', doc)).toHaveLength(1)
    expect($$('[data-kind="news STORY" i]', doc)).toHaveLength(1)
    expect($$('[data-kind="news STORY"]', doc)).toHaveLength(0)
  })

  test('comma lists return each element once, in document order', () => {
    const found = $$('p, article, main', doc).map((e) => e.name)
    expect(found).toEqual(['main', 'article', 'p', 'p'])
  })

  test('no match is null / empty', () => {
    expect($('table', doc)).toBeNull()
    expect($$('.nope', doc)).toEqual([])
  })
})
