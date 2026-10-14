/** Staff sign-in (better-auth): email and password, then a TOTP code. Staff accounts only. */
import { createAuthClient } from 'better-auth/react'
import { adminClient, twoFactorClient } from 'better-auth/client/plugins'
import { origin } from './api'

export const authClient = createAuthClient({
  baseURL: origin,
  basePath: '/api/auth',
  plugins: [twoFactorClient(), adminClient()],
})

export type StaffRole = 'admin' | 'moderator'

export interface StaffSessionUser {
  id: string
  email: string
  name: string
  role: StaffRole
  twoFactorEnabled: boolean
}

/** The signed-in staff member, or null. An unknown role is no role at all. */
export function staffUser(
  user:
    | {
        id: string
        email: string
        name: string
        role?: string | null
        twoFactorEnabled?: boolean | null
      }
    | undefined
    | null,
): StaffSessionUser | null {
  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled === true,
  }
}
