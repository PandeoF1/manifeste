import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Database } from './client.ts'

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url))

/** Applies pending migrations. Safe to run concurrently: drizzle takes an advisory lock. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

export interface MigrationStatus {
  /** Number of migrations shipped with this build. */
  expected: number
  /** Number recorded as applied in the database. */
  applied: number
  /** Hash of the newest shipped migration. */
  latest: string | null
  upToDate: boolean
}

/** Compares shipped migrations with the database (used by the readiness probe). */
export async function migrationStatus(db: Database): Promise<MigrationStatus> {
  const shipped = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  const latest = shipped.at(-1)?.hash ?? null
  const rows = await db
    .execute<{ hash: string }>(
      sql`select hash from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    )
    .catch(() => ({ rows: [] as { hash: string }[] }))
  const count = await db
    .execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)
    .catch(() => ({ rows: [{ n: 0 }] }))
  const applied = count.rows[0]?.n ?? 0
  return {
    expected: shipped.length,
    applied,
    latest,
    upToDate: applied === shipped.length && rows.rows[0]?.hash === latest,
  }
}
