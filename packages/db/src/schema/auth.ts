/**
 * Staff accounts, managed by better-auth (only staff have accounts).
 * Field names follow better-auth's models; the drizzle adapter maps them by schema key.
 */
import { bigint, boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

export const user = pgTable('auth_user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  // admin plugin
  role: text().notNull().default('moderator'),
  banned: boolean().default(false),
  banReason: text(),
  banExpires: timestamp({ withTimezone: true }),
  // two-factor plugin
  twoFactorEnabled: boolean().default(false),
  ...timestamps,
})

export const session = pgTable(
  'auth_session',
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
)

export const account = pgTable(
  'auth_account',
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
)

export const verification = pgTable(
  'auth_verification',
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index().on(t.identifier)],
)

export const twoFactor = pgTable(
  'auth_two_factor',
  {
    id: text().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean().default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.userId), index().on(t.secret)],
)

/** better-auth's built-in rate limiter, stored in Postgres so it survives restarts. */
export const rateLimit = pgTable('auth_rate_limit', {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: 'number' }).notNull(),
})
