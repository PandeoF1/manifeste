import { describe, expect, it } from 'bun:test'
import type { Session } from '@supabase/supabase-js'
import { isAdminSession, staffRole } from '@/lib/staffRole'

const session = (role?: unknown) =>
  ({ user: { app_metadata: role === undefined ? {} : { role } } }) as unknown as Session

describe('role of the signed-in account', () => {
  it('recognises admin and moderator, nothing else', () => {
    expect(staffRole(session('admin'))).toBe('admin')
    expect(staffRole(session('moderator'))).toBe('moderator')
    expect(staffRole(session('user'))).toBeNull()
    expect(staffRole(session())).toBeNull()
    expect(staffRole(null)).toBeNull()
  })

  it('a moderator is not an admin', () => {
    expect(isAdminSession(session('moderator'))).toBe(false)
    expect(isAdminSession(session('admin'))).toBe(true)
  })
})
