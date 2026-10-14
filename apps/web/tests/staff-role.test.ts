import { describe, expect, it } from 'bun:test'
import { TABS, tabsFor, visibleTab } from '@/lib/adminTabs'
import { staffUser } from '@/lib/auth'

const user = (role?: string | null) => ({ id: '1', email: 'a@b.c', name: 'A', role })

describe('role of the signed-in account', () => {
  it('recognises admin and moderator, nothing else', () => {
    expect(staffUser(user('admin'))?.role).toBe('admin')
    expect(staffUser(user('moderator'))?.role).toBe('moderator')
    expect(staffUser(user('user'))).toBeNull()
    expect(staffUser(user())).toBeNull()
    expect(staffUser(null)).toBeNull()
  })

  it('two-factor is on only when the account says so', () => {
    expect(staffUser({ ...user('admin'), twoFactorEnabled: true })?.twoFactorEnabled).toBe(true)
    expect(staffUser(user('admin'))?.twoFactorEnabled).toBe(false)
  })
})

describe('tabs by role', () => {
  it('admins see everything, moderators a short list', () => {
    expect(tabsFor('admin')).toEqual(TABS)
    expect(tabsFor('moderator')).toEqual([
      'moderation',
      'lycees',
      'non-rattaches',
      'stats',
      'medias',
    ])
  })

  it('a moderator asking for an admin tab gets their first tab', () => {
    expect(visibleTab('moderator', 'reglages')).toBe('moderation')
    expect(visibleTab('moderator', 'stats')).toBe('stats')
    expect(visibleTab('admin', 'reglages')).toBe('reglages')
  })
})
