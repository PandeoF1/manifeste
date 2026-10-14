import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { contentSecurityPolicy } from '../src/plugins/security-headers.ts'
import { startTestServer, type TestServer } from './helpers.ts'

describe('security headers', () => {
  let s: TestServer
  beforeAll(async () => {
    s = await startTestServer()
  })
  afterAll(() => s.close())

  test('every response carries the basic headers, API and errors included', async () => {
    for (const path of ['/api/health/live', '/api/nope', '/api/docs/openapi.json']) {
      const res = await s.request(path)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
      expect(res.headers.get('permissions-policy')).toContain('camera=()')
    }
  })

  test('no HSTS outside production, no CSP on JSON', async () => {
    const res = await s.request('/api/health/live')
    expect(res.headers.get('strict-transport-security')).toBeNull()
    expect(res.headers.get('content-security-policy')).toBeNull()
  })

  test('the policy only lets the site, the map and Turnstile in', () => {
    const csp = contentSecurityPolicy(['https://tiles.openfreemap.org'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("connect-src 'self' wss: ws: https://tiles.openfreemap.org")
    expect(csp).toContain("img-src 'self' data: blob: https://tiles.openfreemap.org")
  })
})

describe('security headers in production and on pages', () => {
  let s: TestServer
  beforeAll(async () => {
    // Pages are only served with a built site; production adds HSTS.
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const web = mkdtempSync(join(tmpdir(), 'manifeste-web-'))
    writeFileSync(
      join(web, 'index.html'),
      '<!doctype html><title>x</title><div id="root">x</div><!-- /root -->',
    )
    s = await startTestServer({
      WEB_DIST: web,
      CSP_MAP_ORIGINS: 'https://maps.example, https://tiles2.example',
    })
  })
  afterAll(() => s.close())

  test('a page gets the policy, with the configured map origins', async () => {
    const res = await s.request('/liste', {
      headers: { 'user-agent': 'Mozilla/5.0 Firefox/130.0' },
    })
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain('https://maps.example')
    expect(csp).toContain('https://tiles2.example')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('the app page and the page for robots are cached apart', async () => {
    const human = await s.request('/liste', {
      headers: { 'user-agent': 'Mozilla/5.0 Firefox/130.0' },
    })
    expect(human.headers.get('vary')?.toLowerCase()).toContain('user-agent')
    const bot = await s.request('/liste', {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)' },
    })
    expect(bot.headers.get('vary')?.toLowerCase()).toContain('user-agent')
    expect(bot.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  test('a malformed escape in the path is a 400, not a server error', async () => {
    const res = await s.request('/%E0%A4%A')
    expect(res.status).toBe(400)
  })
})

describe('CSP_MODE', () => {
  test('report-only and off', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const web = mkdtempSync(join(tmpdir(), 'manifeste-web-'))
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>x</title>')
    const ro = await startTestServer({ WEB_DIST: web, CSP_MODE: 'report-only' })
    const roRes = await ro.request('/liste')
    expect(roRes.headers.get('content-security-policy')).toBeNull()
    expect(roRes.headers.get('content-security-policy-report-only')).toContain("default-src 'self'")
    await ro.close()
    const off = await startTestServer({ WEB_DIST: web, CSP_MODE: 'off' })
    const offRes = await off.request('/liste')
    expect(offRes.headers.get('content-security-policy')).toBeNull()
    expect(offRes.headers.get('content-security-policy-report-only')).toBeNull()
    expect(offRes.headers.get('x-content-type-options')).toBe('nosniff')
    await off.close()
  })
})
