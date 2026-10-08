import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { isAdminSession, staffRole } from '@/lib/staffRole'

const session = (role?: unknown) =>
  ({ user: { app_metadata: role === undefined ? {} : { role } } }) as unknown as Session

describe('rôle du compte connecté', () => {
  it('reconnaît administrateur et modérateur, rien d’autre', () => {
    expect(staffRole(session('admin'))).toBe('admin')
    expect(staffRole(session('moderator'))).toBe('moderator')
    expect(staffRole(session('user'))).toBeNull()
    expect(staffRole(session())).toBeNull()
    expect(staffRole(null)).toBeNull()
  })

  it('le modérateur n’est pas administrateur', () => {
    expect(isAdminSession(session('moderator'))).toBe(false)
    expect(isAdminSession(session('admin'))).toBe(true)
  })
})
