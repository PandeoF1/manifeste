import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { treaty } from '@elysiajs/eden'
import { eq } from 'drizzle-orm'
import { schema } from '@manifeste/db'
import { StaffService } from '../src/modules/staff/service.ts'
import { spa } from '../src/web/spa.ts'
import { cookieFrom, startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
beforeAll(async () => {
  s = await startTestServer()
})
afterAll(() => s.close())

describe('health', () => {
  test('liveness', async () => {
    const api = treaty(s.app)
    const { data, status } = await api.api.health.live.get()
    expect(status).toBe(200)
    expect(data).toEqual({ status: 'ok', role: 'all', version: 'dev' })
  })

  test('readiness checks the database, migrations and queue', async () => {
    const { data, status } = await treaty(s.app).api.health.ready.get()
    expect(status).toBe(200)
    expect(data?.status).toBe('ready')
    expect(data?.checks.database.ok).toBe(true)
    expect(data?.checks.migrations.ok).toBe(true)
    expect(data?.checks.queue.ok).toBe(true)
  })
})

describe('API docs', () => {
  test('list public routes only', async () => {
    const res = await s.request('/api/docs/openapi.json')
    expect(res.status).toBe(200)
    const spec = (await res.json()) as { paths: Record<string, unknown> }
    const paths = Object.keys(spec.paths)
    expect(paths).toContain('/api/health/live')
    expect(paths.some((p) => p.startsWith('/api/staff'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/api/auth'))).toBe(false)
  })

  test('serve the Scalar bundle locally', async () => {
    const res = await s.request('/api/docs/scalar.js')
    expect(res.status).toBe(200)
  })
})

describe('staff accounts', () => {
  const password = 'correct horse battery staple'

  async function inviteAndSignIn(email: string, role: 'admin' | 'moderator') {
    const service = new StaffService(s.ctx.db, s.ctx.auth, s.ctx.config.PUBLIC_URL)
    const invitation = await service.invite({ email, name: role, role })
    if (!('passwordLink' in invitation)) throw new Error('invite failed')
    const token = new URL(invitation.passwordLink).pathname.split('/').at(-1)
    const reset = await s.request('/api/auth/reset-password', {
      method: 'POST',
      json: { token, newPassword: password },
    })
    expect(reset.status).toBe(200)
    const signIn = await s.request('/api/auth/sign-in/email', {
      method: 'POST',
      json: { email, password },
    })
    expect(signIn.status).toBe(200)
    return cookieFrom(signIn)
  }

  test('public sign-up is disabled', async () => {
    const res = await s.request('/api/auth/sign-up/email', {
      method: 'POST',
      json: { email: 'intruder@example.org', password, name: 'x' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('staff routes need a session', async () => {
    const { status } = await treaty(s.app).api.staff.members.get()
    expect(status).toBe(401)
  })

  test('moderators cannot manage staff', async () => {
    const cookie = await inviteAndSignIn('mod@example.org', 'moderator')
    const res = await s.request('/api/staff/members', { headers: { cookie } })
    expect(res.status).toBe(403)
  })

  test('admins must enable TOTP, then can list and invite', async () => {
    const cookie = await inviteAndSignIn('admin@example.org', 'admin')
    const before = await s.request('/api/staff/members', { headers: { cookie } })
    expect(before.status).toBe(403)
    expect(await before.text()).toContain('Two-factor')

    await s.ctx.db
      .update(schema.user)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.user.email, 'admin@example.org'))

    const api = treaty(s.app, { headers: { cookie, origin: s.ctx.config.PUBLIC_URL } })
    const list = await api.api.staff.members.get()
    expect(list.status).toBe(200)
    expect(list.data?.map((m) => m.email)).toEqual(['mod@example.org', 'admin@example.org'])

    const invite = await api.api.staff.members.post({
      email: 'New@Example.org',
      name: 'New',
      role: 'moderator',
    })
    expect(invite.status).toBe(200)
    expect(invite.data?.passwordLink).toContain('/api/auth/reset-password/')

    const again = await api.api.staff.members.post({
      email: 'new@example.org',
      name: 'New',
      role: 'moderator',
    })
    expect(again.status).toBe(409)
  })
})

describe('SPA', () => {
  const dist = mkdtempSync(join(tmpdir(), 'manifeste-dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Manifeste</title>')
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(join(dist, 'sw.js'), 'self')
  const app = spa(dist)
  const get = (path: string) => app.handle(new Request(`http://x${path}`))

  test('client routes get index.html', async () => {
    const res = await get('/lycee/0750001A')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>Manifeste</title>')
    expect(res.headers.get('cache-control')).toContain('must-revalidate')
  })

  test('hashed assets are immutable', async () => {
    const res = await get('/assets/app-abc123.js')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  test('missing files and unknown API routes are 404', async () => {
    expect((await get('/assets/missing.js')).status).toBe(404)
    expect((await get('/api/nope')).status).toBe(404)
  })

  test('paths cannot escape the dist folder', async () => {
    expect((await get('/..%2f..%2fetc%2fpasswd')).status).toBe(404)
  })
})
