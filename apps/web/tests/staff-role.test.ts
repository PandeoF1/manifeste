import { describe, expect, it } from 'bun:test'
import {
  groupsFor,
  TABS,
  TAB_GROUPS,
  TAB_HINTS,
  TAB_LABELS,
  tabsFor,
  visibleTab,
} from '@/lib/adminTabs'
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

describe('sidebar groups', () => {
  it('every tab is in exactly one group, and has a label and a hint', () => {
    const grouped = TAB_GROUPS.flatMap((g) => g.tabs)
    expect([...grouped].sort()).toEqual([...TABS].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
    for (const t of TABS) {
      expect(TAB_LABELS[t].length).toBeGreaterThan(0)
      expect(TAB_HINTS[t].length).toBeGreaterThan(0)
    }
  })

  it('admins get every group, moderators only the tabs they may use and no empty group', () => {
    expect(groupsFor('admin').flatMap((g) => g.tabs).length).toBe(TABS.length)
    const mod = groupsFor('moderator')
    expect(mod.flatMap((g) => g.tabs)).toEqual([...tabsFor('moderator')])
    expect(mod.every((g) => g.tabs.length > 0)).toBe(true)
    expect(mod.map((g) => g.id)).toEqual(['moderation', 'analyse'])
  })
})
