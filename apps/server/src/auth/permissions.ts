/**
 * What each staff role may do. There are only two roles and no public accounts:
 * - admin: everything (sources, settings, AI, staff accounts…)
 * - moderator: the moderation queue, the unmatched queue and the anonymous site statistics. Every action is audited.
 */
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access'

export const statements = {
  ...defaultStatements,
  report: ['moderate', 'edit', 'hide'],
  unmatched: ['link', 'dismiss'],
  source: ['manage'],
  settings: ['manage'],
  ai: ['view', 'manage'],
  stats: ['view'],
  pipeline: ['view', 'operate'],
  movement: ['manage'],
} as const

export const ac = createAccessControl(statements)

export const roles = {
  admin: ac.newRole({
    ...adminAc.statements,
    report: ['moderate', 'edit', 'hide'],
    unmatched: ['link', 'dismiss'],
    source: ['manage'],
    settings: ['manage'],
    ai: ['view', 'manage'],
    stats: ['view'],
    pipeline: ['view', 'operate'],
    movement: ['manage'],
  }),
  moderator: ac.newRole({
    report: ['moderate'],
    unmatched: ['link', 'dismiss'],
    stats: ['view'],
  }),
}

export type StaffRole = keyof typeof roles
export const STAFF_ROLES = Object.keys(roles) as StaffRole[]

export type Permission = {
  [K in keyof typeof statements]?: ReadonlyArray<(typeof statements)[K][number]>
}

export const isStaffRole = (role: unknown): role is StaffRole =>
  typeof role === 'string' && role in roles

/** Pure check, no database access: roles are static. */
export function can(role: unknown, permission: Permission): boolean {
  if (!isStaffRole(role)) return false
  return roles[role].authorize(permission as never).success
}
