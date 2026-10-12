import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { checkStaff, TWO_FACTOR_REQUIRED } from '../src/auth/plugin.ts'
import type { StaffSession } from '../src/auth/auth.ts'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

const as = (user: Partial<StaffSession['user']>) =>
  ({
    session: {},
    user: { role: 'moderator', twoFactorEnabled: false, banned: false, ...user },
  }) as StaffSession

describe('checkStaff with the two-factor policy "all"', () => {
  test('moderators must enrol too', () => {
    expect(checkStaff(as({}), true, 'all')).toEqual({
      ok: false,
      status: 403,
      message: TWO_FACTOR_REQUIRED,
    })
    expect(checkStaff(as({ twoFactorEnabled: true }), true, 'all').ok).toBe(true)
  })
  test('unknown roles are still refused, not asked to enrol', () => {
    expect(checkStaff(as({ role: 'visitor' }), true, 'all')).toMatchObject({ message: 'Forbidden' })
  })
})

describe("better-auth's admin endpoints", () => {
  let s: TestServer
  beforeAll(async () => {
    s = await startTestServer()
  })
  afterAll(async () => {
    await s.close()
  })

  test('refuse an admin who has not enabled two-factor authentication', async () => {
    const cookie = await signInStaff(s, 'no-totp@example.org', 'admin', { twoFactor: false })
    // Before the gate, better-auth answered this with the whole staff list.
    const res = await s.request('/api/auth/admin/list-users?limit=5', { headers: { cookie } })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('Two-factor')
  })

  test('refuse the writes too (set-role, set-user-password…)', async () => {
    const cookie = await signInStaff(s, 'no-totp2@example.org', 'admin', { twoFactor: false })
    const res = await s.request('/api/auth/admin/set-role', {
      method: 'POST',
      headers: { cookie },
      json: { userId: 'whoever', role: 'admin' },
    })
    expect(res.status).toBe(403)
  })

  test('answer 401 without a session', async () => {
    const res = await s.request('/api/auth/admin/list-users')
    expect(res.status).toBe(401)
  })

  test('the two-factor enrolment endpoints stay reachable without it', async () => {
    const cookie = await signInStaff(s, 'enrol@example.org', 'admin', { twoFactor: false })
    const res = await s.request('/api/auth/two-factor/enable', {
      method: 'POST',
      headers: { cookie },
      json: { password: 'not the password' },
    })
    // Refused for the wrong password, not for the missing second factor.
    expect(res.status).not.toBe(401)
    expect(await res.text()).not.toContain('Two-factor authentication required')
  })

  test('work for an admin with two-factor, and leave an audit line', async () => {
    const cookie = await signInStaff(s, 'totp@example.org', 'admin')
    const victim = await signInStaff(s, 'victim@example.org', 'moderator')
    expect(victim).toBeTruthy()
    const [target] = await s.ctx.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, 'victim@example.org'))
    const list = await s.request('/api/auth/admin/list-users?limit=5', { headers: { cookie } })
    expect(list.status).toBe(200)
    const ban = await s.request('/api/auth/admin/ban-user', {
      method: 'POST',
      headers: { cookie },
      json: { userId: target?.id, banReason: 'test' },
    })
    expect(ban.status).toBe(200)
    const lines = await s.ctx.db
      .select()
      .from(schema.moderationAudit)
      .where(eq(schema.moderationAudit.action, 'auth.admin/ban-user'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ actorEmail: 'totp@example.org', target: target?.id })
    expect(JSON.stringify(lines[0]?.after)).toContain('banReason')
  })

  test('a failed call leaves no audit line', async () => {
    const cookie = await signInStaff(s, 'totp2@example.org', 'admin')
    const res = await s.request('/api/auth/admin/ban-user', {
      method: 'POST',
      headers: { cookie },
      json: { userId: 'does-not-exist' },
    })
    expect(res.ok).toBe(false)
    const lines = await s.ctx.db
      .select()
      .from(schema.moderationAudit)
      .where(eq(schema.moderationAudit.target, 'does-not-exist'))
    expect(lines).toHaveLength(0)
  })
})

describe('STAFF_2FA=all', () => {
  let s: TestServer
  beforeAll(async () => {
    s = await startTestServer({ STAFF_2FA: 'all' })
  })
  afterAll(async () => {
    await s.close()
  })

  test('a moderator without two-factor is sent to enrol', async () => {
    const cookie = await signInStaff(s, 'mod@example.org', 'moderator', { twoFactor: false })
    const res = await s.request('/api/staff/reports/pending', { headers: { cookie } })
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('Two-factor')
  })

  test('and is let in once enrolled', async () => {
    const cookie = await signInStaff(s, 'mod2@example.org', 'moderator', { twoFactor: true })
    const res = await s.request('/api/staff/reports/pending', { headers: { cookie } })
    expect(res.status).toBe(200)
  })
})
