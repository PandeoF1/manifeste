import type { Session } from '@supabase/supabase-js'

export type StaffRole = 'admin' | 'moderator'

/** Rôle du compte connecté (app_metadata.role) : admin, modérateur, ou aucun. */
export function staffRole(session: Session | null): StaffRole | null {
  const role = session?.user.app_metadata?.role
  return role === 'admin' || role === 'moderator' ? role : null
}

export function isAdminSession(session: Session | null): boolean {
  return staffRole(session) === 'admin'
}
