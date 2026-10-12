import { expect, test } from '@playwright/test'

/**
 * The server sends a strict Content-Security-Policy with the pages (apps/server/src/plugins/
 * security-headers.ts). A page that needs something the policy forbids would break only in a
 * browser: this loads every kind of page and fails on any violation the browser reports.
 * (Map tiles and Turnstile are unreachable from CI: that is a network error, not a violation.)
 */
const PAGES = ['/', '/liste', '/donnees', '/signaler', '/a-propos', '/admin']
const EMBEDS = ['/embed/chiffres', '/embed/carte']

for (const path of [...PAGES, ...EMBEDS]) {
  test(`no Content-Security-Policy violation on ${path}`, async ({ page }) => {
    const violations: string[] = []
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.log(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`)
      })
    })
    page.on('console', (m) => {
      if (m.text().startsWith('CSP-VIOLATION')) violations.push(m.text())
    })
    const res = await page.goto(path)
    const csp = res?.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'self'")
    // The pages made to be embedded on other sites must allow it; the others must not.
    expect(csp).toContain(EMBEDS.includes(path) ? 'frame-ancestors *' : "frame-ancestors 'none'")
    await page.waitForTimeout(2_000)
    expect(violations).toEqual([])
  })
}
