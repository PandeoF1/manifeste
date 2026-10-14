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
  /**
   * Longest a single statement may run, in ms. Unset for migrations (an index build is long);
   * set for the API and the worker so that one bad query cannot hold a connection for ever.
   */
  statementTimeoutMs?: number
  /** Called with errors of idle connections (a restart of the database, a dropped network). */
  onPoolError?: (error: Error) => void
}

/** One pool per process: drizzle, pg-boss and better-auth all share it. */
export function createDb(url: string, options: DbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'manifeste',
    // Without a timeout, a request that finds the pool empty waits for ever.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ...(options.statementTimeoutMs && { statement_timeout: options.statementTimeoutMs }),
  })
  // An "error" on an idle client with no listener is an uncaught exception: it would stop the
  // process when the database restarts. The pool replaces the broken connection by itself.
  pool.on('error', (error) => options.onPoolError?.(error))
  const db = drizzle({ client: pool, schema, casing: 'snake_case' })
  return { db, pool, close: () => pool.end() }
}
