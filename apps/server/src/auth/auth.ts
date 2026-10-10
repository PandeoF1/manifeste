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

export function createAuth(deps: { db: Database; config: Config; log: Logger }) {
  const { db, config, log } = deps
  return betterAuth({
    appName: 'Manifeste',
    logger: {
      level: 'warn',
      log: (level, message, ...args) =>
        log[level]({ args: args.length ? args : undefined }, message),
    },
    baseURL: config.PUBLIC_URL,
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
      cookiePrefix: 'manifeste',
      useSecureCookies: config.PUBLIC_URL.startsWith('https://'),
      database: { generateId: () => crypto.randomUUID() },
    },
    plugins: [
      admin({ ac, roles, defaultRole: 'moderator', adminRoles: ['admin'] }),
      twoFactor({ issuer: 'Manifeste' }),
    ],
  })
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
