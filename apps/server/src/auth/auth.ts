/**
 * Staff authentication (better-auth). Public sign-up is disabled: accounts are created by an
 * admin (or the `staff` CLI), who hands over a one-time link to choose a password.
 * Admins must enable TOTP before reaching any staff route (enforced by the `staff` macro).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, twoFactor } from 'better-auth/plugins'
import { schema, type Database } from '@manifeste/db'
import type { Config } from '../config.ts'
import type { Logger } from '../logger.ts'
import { ac, roles } from './permissions.ts'

/** Password links captured while an invite is being issued (no email provider). */
const linkCapture = new AsyncLocalStorage<{ url?: string }>()

export const PASSWORD_LINK_TTL_SECONDS = 72 * 3600

/** Origin the visitor used, from the proxy headers; https in production (TLS ends at Cloudflare). */
export function requestOrigin(request: Request): string[] {
  const host = (
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host
  )
    .split(',')[0]
    ?.trim()
  if (!host) return []
  const proto =
    process.env.NODE_ENV === 'production'
      ? 'https'
      : (request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http')
  return [`${proto}://${host}`]
}

export type TwoFactorPolicy = 'admin' | 'all' | 'none'

/** Which roles must have TOTP enabled, per auth instance (read by the `staff` rule and the admin gate). */
const policies = new WeakMap<object, TwoFactorPolicy>()
export const twoFactorPolicyOf = (auth: object): TwoFactorPolicy => policies.get(auth) ?? 'admin'

export function createAuth(deps: { db: Database; config: Config; log: Logger }) {
  const { db, config, log } = deps
  const auth = betterAuth({
    appName: 'Manifeste',
    logger: {
      level: 'warn',
      log: (level, message, ...args) =>
        log[level]({ args: args.length ? args : undefined }, message),
    },
    baseURL: config.PUBLIC_URL,
    // The page's own origin is always trusted (same-origin, which is what the CSRF check wants), so a
    // PUBLIC_URL that disagrees with the domain behind the proxy cannot lock the staff out.
    trustedOrigins: (request) => (request ? [config.PUBLIC_URL, ...requestOrigin(request)] : []),
    basePath: '/api/auth',
    secret: config.AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      resetPasswordTokenExpiresIn: PASSWORD_LINK_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const capture = linkCapture.getStore()
        if (capture) capture.url = url
        else log.warn({ userId: user.id }, 'password reset requested outside an invite; no mailer')
      },
    },
    session: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
    rateLimit: { enabled: config.NODE_ENV !== 'test', storage: 'database' },
    advanced: {
      // The rate limiter needs the visitor's address. Behind Cloudflare it is cf-connecting-ip;
      // the first X-Forwarded-For entry is the fallback (the proxy appends, so keep it behind one).
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
      cookiePrefix: 'manifeste',
      useSecureCookies: config.PUBLIC_URL.startsWith('https://'),
      database: { generateId: () => crypto.randomUUID() },
    },
    plugins: [
      admin({ ac, roles, defaultRole: 'moderator', adminRoles: ['admin'] }),
      twoFactor({ issuer: 'Manifeste' }),
    ],
  })
  policies.set(auth, config.STAFF_2FA)
  return auth
}

export type Auth = ReturnType<typeof createAuth>
export type StaffSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
export type StaffUser = StaffSession['user']

/** Runs `fn` and returns the password link better-auth generated during it. */
export async function capturePasswordLink(fn: () => Promise<unknown>): Promise<string> {
  const store: { url?: string } = {}
  await linkCapture.run(store, fn)
  if (!store.url) throw new Error('better-auth did not produce a password link')
  return store.url
}
