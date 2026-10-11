import { describe, expect, test } from 'bun:test'
import type { StaffSession } from '../src/auth/auth.ts'
import { checkStaff, TWO_FACTOR_REQUIRED } from '../src/auth/plugin.ts'
import { can } from '../src/auth/permissions.ts'

const session = (user: Partial<StaffSession['user']>) =>
  ({
    session: {},
    user: { role: 'moderator', twoFactorEnabled: false, banned: false, ...user },
  }) as StaffSession

describe('can', () => {
  test('moderators only moderate and handle unmatched items', () => {
    expect(can('moderator', { report: ['moderate'] })).toBe(true)
    expect(can('moderator', { unmatched: ['link', 'dismiss'] })).toBe(true)
    expect(can('moderator', { stats: ['view'] })).toBe(true)
    expect(can('moderator', { ai: ['view'] })).toBe(false)
    expect(can('moderator', { report: ['hide'] })).toBe(false)
    expect(can('moderator', { source: ['manage'] })).toBe(false)
    expect(can('moderator', { settings: ['manage'] })).toBe(false)
    expect(can('moderator', { user: ['create'] })).toBe(false)
  })

  test('admins can do everything', () => {
    expect(can('admin', { source: ['manage'], settings: ['manage'], user: ['create'] })).toBe(true)
  })

  test('unknown roles get nothing', () => {
    expect(can('visitor', { report: ['moderate'] })).toBe(false)
    expect(can(undefined, {})).toBe(false)
  })
})

describe('checkStaff', () => {
  test('401 without a session', () => {
    expect(checkStaff(null, true)).toMatchObject({ ok: false, status: 401 })
  })

  test('admins must enable two-factor authentication first', () => {
    expect(checkStaff(session({ role: 'admin' }), true)).toEqual({
      ok: false,
      status: 403,
      message: TWO_FACTOR_REQUIRED,
    })
    expect(checkStaff(session({ role: 'admin', twoFactorEnabled: true }), true).ok).toBe(true)
  })

  test('moderators do not need two-factor authentication', () => {
    expect(checkStaff(session({}), { report: ['moderate'] }).ok).toBe(true)
  })

  test('403 when the permission is missing or the account is banned', () => {
    expect(checkStaff(session({}), { source: ['manage'] })).toMatchObject({ status: 403 })
    expect(checkStaff(session({ banned: true }), true)).toMatchObject({ status: 403 })
    expect(checkStaff(session({ role: 'visitor' }), true)).toMatchObject({ status: 403 })
  })
})
