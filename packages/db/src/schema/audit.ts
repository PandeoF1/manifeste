import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

/** Every staff action on reports, sources and settings: who, what, before and after. */
export const moderationAudit = pgTable(
  'moderation_audit',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorId: text().references(() => user.id, { onDelete: 'set null' }),
    /** Kept when the account is deleted. */
    actorEmail: text(),
    action: text().notNull(),
    target: text(),
    before: jsonb(),
    after: jsonb(),
  },
  (t) => [index().on(t.at.desc())],
)
