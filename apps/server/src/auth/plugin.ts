/**
 * Elysia side of staff auth:
 * - `authRoutes` forwards /api/auth/* to better-auth (sign-in, 2FA, sessions, admin endpoints),
 *   mounted once at the root;
 * - `authPlugin` adds the `staff` macro to a module: `{ staff: true }` needs any staff session, `{ staff: { report: ['moderate'] } }`
 *   needs that permission. Admins without TOTP get 403 until they enable it.
 */
import { Elysia } from 'elysia'
import type { Auth, StaffSession, TwoFactorPolicy } from './auth.ts'
import { twoFactorPolicyOf } from './auth.ts'
import { can, isStaffRole, type Permission } from './permissions.ts'

export const TWO_FACTOR_REQUIRED = 'Two-factor authentication required'

export type StaffCheck =
  { ok: true; staff: StaffSession } | { ok: false; status: 401 | 403; message: string }

/** The decision behind the macro, kept pure for tests. */
export function checkStaff(
  session: StaffSession | null,
  required: true | Permission,
  twoFactor: TwoFactorPolicy = 'admin',
): StaffCheck {
  if (!session) return { ok: false, status: 401, message: 'Unauthorized' }
  const { role, twoFactorEnabled, banned } = session.user
  if (banned) return { ok: false, status: 403, message: 'Forbidden' }
  const mustEnrol =
    twoFactor !== 'none' && (role === 'admin' || (twoFactor === 'all' && isStaffRole(role)))
  if (mustEnrol && !twoFactorEnabled)
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

/** Records a staff action done through better-auth's own admin API (it has no audit of its own). */
export type AdminAudit = (
  actor: { user: { id: string; email: string } },
  action: string,
  target: string | null,
  after: unknown,
) => Promise<void>

/** Fields worth keeping in the audit line of an admin call; never a password or a token. */
const AUDITED_FIELDS = ['role', 'banReason', 'banExpiresIn'] as const

/**
 * `/api/auth/admin/*` (create-user, set-role, set-user-password, ban, impersonate…) is better-auth's
 * own endpoint set, so the `staff` rule of the Elysia routes does not cover it. Without this gate
 * an admin who had not enabled TOTP yet (just invited, password chosen) could use it freely.
 * The two-factor enrolment endpoints live elsewhere (`/api/auth/two-factor/*`) and stay open.
 */
export async function guardAdminEndpoint(
  auth: Auth,
  request: Request,
): Promise<{ ok: true; staff: StaffSession } | { ok: false; response: Response }> {
  const session = await auth.api.getSession({ headers: request.headers })
  const check = checkStaff(session, true, twoFactorPolicyOf(auth))
  if (!check.ok)
    return {
      ok: false,
      response: Response.json({ message: check.message }, { status: check.status }),
    }
  return { ok: true, staff: check.staff }
}

async function handleAuth(auth: Auth, request: Request, onAdminAction?: AdminAudit) {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/auth/admin/')) return auth.handler(request)

  const gate = await guardAdminEndpoint(auth, request)
  if (!gate.ok) return gate.response
  // The handler consumes the body: read a copy for the audit line.
  const body = (
    request.method === 'POST'
      ? await request
          .clone()
          .json()
          .catch(() => null)
      : null
  ) as Record<string, unknown> | null
  const response = await auth.handler(request)
  if (onAdminAction && request.method === 'POST' && response.ok) {
    const picked = Object.fromEntries(
      AUDITED_FIELDS.filter((k) => body?.[k] !== undefined).map((k) => [k, body?.[k]]),
    )
    const target = typeof body?.userId === 'string' ? body.userId : null
    await onAdminAction(gate.staff, `auth.${pathname.slice('/api/auth/'.length)}`, target, picked)
  }
  return response
}

/**
 * Every method is registered by name: the SPA's `GET /*` fallback would win over an `ALL` route
 * for GET requests (a method-specific wildcard beats a catch-all method), and the session read
 * (`GET /api/auth/get-session`) would answer 404.
 */
export const authRoutes = (auth: Auth, onAdminAction?: AdminAudit) =>
  new Elysia({ name: 'auth.routes' })
    .get('/api/auth/*', ({ request }) => handleAuth(auth, request, onAdminAction), {
      detail: { hide: true },
    })
    .post('/api/auth/*', ({ request }) => handleAuth(auth, request, onAdminAction), {
      detail: { hide: true },
    })

const createAuthPlugin = (auth: Auth) =>
  new Elysia({ name: 'auth' }).macro({
    staff: (required: true | Permission) => ({
      async resolve({ status, request }) {
        const session = await auth.api.getSession({ headers: request.headers })
        const check = checkStaff(session, required, twoFactorPolicyOf(auth))
        if (!check.ok) return status(check.status, check.message)
        return { staff: check.staff }
      },
    }),
  })
