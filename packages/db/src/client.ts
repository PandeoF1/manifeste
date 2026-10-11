import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index.ts'

export type Schema = typeof schema
export type Database = NodePgDatabase<Schema> & { $client: pg.Pool }

export interface DbHandle {
  db: Database
  pool: pg.Pool
  close(): Promise<void>
}

export interface DbOptions {
  /** Pool size. The API and the worker each hold their own pool. */
  max?: number
  /** Shown in pg_stat_activity, handy when debugging locks. */
  applicationName?: string
}

/** One pool per process: drizzle, pg-boss and better-auth all share it. */
export function createDb(url: string, options: DbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'manifeste',
  })
  const db = drizzle({ client: pool, schema, casing: 'snake_case' })
  return { db, pool, close: () => pool.end() }
}
