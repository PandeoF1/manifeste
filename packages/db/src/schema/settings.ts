import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

/**
 * Runtime settings changed from the admin (judge tiers, AI kill switches…).
 * Each key has a TypeBox schema in the server; the value is validated on read and write.
 */
export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: text().references(() => user.id, { onDelete: 'set null' }),
})
