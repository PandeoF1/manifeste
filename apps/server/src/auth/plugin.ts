/**
 * Elysia side of staff auth:
 * - `authRoutes` forwards /api/auth/* to better-auth (sign-in, 2FA, sessions, admin endpoints),
 *   mounted once at the root;
 * - `authPlugin` adds the `staff` macro to a module: `{ staff: true }` needs any staff session, `{ staff: { report: ['moderate'] } }`
 *   needs that permission. Admins without TOTP get 403 until they enable it.
 */
import { Elysia } from 'elysia'
import type { Auth, StaffSession } from './auth.ts'
import { can, isStaffRole, type Permission } from './permissions.ts'

export const TWO_FACTOR_REQUIRED = 'Two-factor authentication required'

export type StaffCheck =
  { ok: true; staff: StaffSession } | { ok: false; status: 401 | 403; message: string }

/** The decision behind the macro, kept pure for tests. */
export function checkStaff(session: StaffSession | null, required: true | Permission): StaffCheck {
  if (!session) return { ok: false, status: 401, message: 'Unauthorized' }
  const { role, twoFactorEnabled, banned } = session.user
  if (banned) return { ok: false, status: 403, message: 'Forbidden' }
  if (role === 'admin' && !twoFactorEnabled)
    return { ok: false, status: 403, message: TWO_FACTOR_REQUIRED }
  const allowed = required === true ? isStaffRole(role) : can(role, required)
  if (!allowed) return { ok: false, status: 403, message: 'Forbidden' }
  return { ok: true, staff: session }
}

const plugins = new WeakMap<Auth, ReturnType<typeof createAuthPlugin>>()

/** One plugin instance per auth instance, so modules can all `.use()` it (deduplicated by name). */
export function authPlugin(auth: Auth) {
  let plugin = plugins.get(auth)
  if (!plugin) plugins.set(auth, (plugin = createAuthPlugin(auth)))
  return plugin
}

export const authRoutes = (auth: Auth) =>
  new Elysia({ name: 'auth.routes' }).all('/api/auth/*', ({ request }) => auth.handler(request), {
    detail: { hide: true },
  })

const createAuthPlugin = (auth: Auth) =>
  new Elysia({ name: 'auth' }).macro({
    staff: (required: true | Permission) => ({
      async resolve({ status, request }) {
        const session = await auth.api.getSession({ headers: request.headers })
        const check = checkStaff(session, required)
        if (!check.ok) return status(check.status, check.message)
        return { staff: check.staff }
      },
    }),
  })
