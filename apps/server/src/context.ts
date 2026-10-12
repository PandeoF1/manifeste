/**
 * Everything a process needs, built once at boot and passed to modules and jobs.
 * Tests build the same context against a throwaway database.
 */
import { createDb, type Database, type DbHandle } from '@manifeste/db'
import { aiConfigFromEnv, createAi, createMeter, type Ai } from '@manifeste/ai'
import { createAuth, type Auth } from './auth/auth.ts'
import type { Config } from './config.ts'
import type { IngestConfig } from './ingest/config.ts'
import { createLogger, type Logger } from './logger.ts'
import { AiUsageService } from './modules/ai/service.ts'
import { EventBus } from './realtime/bus.ts'
import { PgBossQueue, type JobQueue } from './queue/queue.ts'
import type { BlobStore } from './storage/blob-store.ts'
import { createBlobStore } from './storage/create-blob-store.ts'

export interface AppContext {
  config: Config
  log: Logger
  db: Database
  auth: Auth
  queue: JobQueue
  blobs: BlobStore
  bus: EventBus
  /** AI models, chains and judge, built from the validated configuration. */
  ai: Ai
  /** Persists AI usage and answers the daily budget guard. */
  aiUsage: AiUsageService
  /** Pipeline tunables beyond the defaults (tests). */
  ingestConfig?: Partial<IngestConfig>
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
  const bus = new EventBus(config.DATABASE_URL, dbHandle.db, log.child({ component: 'bus' }))
  const auth = createAuth({ db: dbHandle.db, config, log: log.child({ component: 'auth' }) })
  const { ai, aiUsage } = createAiRuntime(config, dbHandle.db, log)
  return {
    config,
    log,
    db: dbHandle.db,
    auth,
    queue,
    bus,
    ai,
    aiUsage,
    blobs: overrides.blobs ?? createBlobStore(config),
    version: process.env.APP_VERSION ?? 'dev',
    async close() {
      await aiUsage.flush()
      await bus.stop()
      await queue.stop()
      await dbHandle.close()
    },
  }
}

/**
 * AI from the environment. Without keys the AI is switched off (a dev machine still boots); in
 * production a worker without them refuses to start, because ingestion would silently do nothing.
 */
function createAiRuntime(config: Config, db: Database, log: Logger) {
  const meter = createMeter()
  let aiConfig = aiConfigFromEnv(config as unknown as Record<string, string | undefined>)
  if (aiConfig.enabled && !aiConfig.credentials.gemini) {
    if (config.NODE_ENV === 'production' && config.ROLE !== 'api')
      throw new Error('GEMINI_API_KEY is required in production (or set AI_ENABLED=false)')
    log.warn('GEMINI_API_KEY is not set: AI is switched off')
    aiConfig = { ...aiConfig, enabled: false }
  }
  const aiUsage: AiUsageService = new AiUsageService(
    db,
    () => meter.spentUsd,
    () => meter.drain(),
  )
  const ai = createAi(aiConfig, { sink: meter, spentToday: () => aiUsage.spentTodayCached() })
  return { ai, aiUsage }
}
