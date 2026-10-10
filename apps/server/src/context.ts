/**
 * Everything a process needs, built once at boot and passed to modules and jobs.
 * Tests build the same context against a throwaway database.
 */
import { createDb, type Database, type DbHandle } from '@manifeste/db'
import { createAuth, type Auth } from './auth/auth.ts'
import type { Config } from './config.ts'
import { createLogger, type Logger } from './logger.ts'
import { PgBossQueue, type JobQueue } from './queue/queue.ts'
import { FsBlobStore, type BlobStore } from './storage/blob-store.ts'

export interface AppContext {
  config: Config
  log: Logger
  db: Database
  auth: Auth
  queue: JobQueue
  blobs: BlobStore
  /** Build id (git sha in images), shown by the health endpoints. */
  version: string
  close(): Promise<void>
}

export function createContext(
  config: Config,
  overrides: { log?: Logger; dbHandle?: DbHandle; queue?: JobQueue; blobs?: BlobStore } = {},
): AppContext {
  const log = overrides.log ?? createLogger(config.LOG_LEVEL, { role: config.ROLE })
  const dbHandle =
    overrides.dbHandle ??
    createDb(config.DATABASE_URL, {
      max: config.DATABASE_POOL_MAX,
      applicationName: `manifeste-${config.ROLE}`,
    })
  const runsJobs = config.ROLE !== 'api'
  const queue =
    overrides.queue ??
    new PgBossQueue(config.DATABASE_URL, log.child({ component: 'queue' }), {
      supervise: runsJobs,
    })
  const auth = createAuth({ db: dbHandle.db, config, log: log.child({ component: 'auth' }) })
  return {
    config,
    log,
    db: dbHandle.db,
    auth,
    queue,
    blobs: overrides.blobs ?? new FsBlobStore(config.DATA_DIR),
    version: process.env.APP_VERSION ?? 'dev',
    async close() {
      await queue.stop()
      await dbHandle.close()
    },
  }
}
