import { Elysia, t } from 'elysia'
import { schema, type Database } from '@manifeste/db'
import { and, desc, eq, lt } from 'drizzle-orm'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'

/** The audit trail: who did what, before and after (admins). */
export const auditModule = (auth: Auth, db: Database) =>
  new Elysia({ name: 'module.audit', prefix: '/api/staff/audit' }).use(authPlugin(auth)).get(
    '/',
    ({ query }) =>
      db
        .select()
        .from(schema.moderationAudit)
        .where(
          and(
            query.before !== undefined ? lt(schema.moderationAudit.id, query.before) : undefined,
            query.action ? eq(schema.moderationAudit.action, query.action) : undefined,
          ),
        )
        .orderBy(desc(schema.moderationAudit.id))
        .limit(query.limit ?? 100),
    {
      staff: { settings: ['manage'] },
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500, default: 100 })),
        before: t.Optional(t.Numeric()),
        action: t.Optional(t.String()),
      }),
      detail: { tags: ['staff'], summary: 'Audit lines, newest first (`before` pages back)' },
    },
  )
