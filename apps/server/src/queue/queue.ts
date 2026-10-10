/**
 * Job queue port. Postgres-backed (pg-boss) so jobs live next to the data they touch:
 * no Redis to run, back up or monitor. Swapping the backend means another implementation
 * of `JobQueue`, nothing else changes.
 */
import { PgBoss } from 'pg-boss'
import type { Logger } from '../logger.ts'

/** Every job the system knows, with its payload. Grows phase by phase. */
export interface JobPayloads {
  'system.heartbeat': Record<string, never>
}
export type JobName = keyof JobPayloads

export interface QueueOptions {
  /**
   * standard: no uniqueness. exclusive: at most one queued-or-active job per singleton key
   * (what idempotent per-item stages want). Fixed when the queue is first created.
   */
  policy?: 'standard' | 'exclusive' | 'stately' | 'singleton'
  /** Attempts after the first failure (exponential backoff). */
  retryLimit?: number
  retryDelaySeconds?: number
  /** A failed job's payload is copied there once retries are exhausted. */
  deadLetter?: JobName
  expireInSeconds?: number
}

export interface SendOptions {
  /** On an `exclusive` queue: same key while a job is queued or active = no duplicate. */
  singletonKey?: string
  startAfterSeconds?: number
  priority?: number
}

export interface WorkOptions {
  batchSize?: number
  /** Jobs of this queue processed at the same time by this process. */
  concurrency?: number
  pollingIntervalSeconds?: number
}

export interface Job<N extends JobName> {
  id: string
  name: N
  data: JobPayloads[N]
  retryCount: number
  signal: AbortSignal
}

export interface QueueStat {
  name: string
  queued: number
  ready: number
  active: number
  deferred: number
  failed: number
  total: number
}

export interface JobQueue {
  start(): Promise<void>
  stop(): Promise<void>
  define<N extends JobName>(name: N, options?: QueueOptions): Promise<void>
  send<N extends JobName>(
    name: N,
    data: JobPayloads[N],
    options?: SendOptions,
  ): Promise<string | null>
  work<N extends JobName>(
    name: N,
    handler: (jobs: Job<N>[]) => Promise<void>,
    options?: WorkOptions,
  ): Promise<void>
  schedule<N extends JobName>(name: N, cron: string, data: JobPayloads[N]): Promise<void>
  stats(): Promise<QueueStat[]>
  isStarted(): boolean
}

export class PgBossQueue implements JobQueue {
  private readonly boss: PgBoss
  private started = false

  constructor(
    connectionString: string,
    private readonly log: Logger,
    options: { schema?: string; max?: number; supervise?: boolean } = {},
  ) {
    this.boss = new PgBoss({
      connectionString,
      schema: options.schema ?? 'pgboss',
      max: options.max ?? 4,
      application_name: 'manifeste-queue',
      // Only processes that run jobs need maintenance and cron.
      supervise: options.supervise ?? true,
      schedule: options.supervise ?? true,
    })
    this.boss.on('error', (error) => this.log.error({ err: error }, 'queue error'))
  }

  async start() {
    await this.boss.start()
    this.started = true
  }

  async stop() {
    if (!this.started) return
    this.started = false
    await this.boss.stop({ graceful: true, timeout: 20_000 })
  }

  isStarted() {
    return this.started
  }

  async define<N extends JobName>(name: N, options: QueueOptions = {}) {
    const queue = {
      retryLimit: options.retryLimit ?? 3,
      retryDelay: options.retryDelaySeconds ?? 30,
      retryBackoff: true,
      expireInSeconds: options.expireInSeconds ?? 15 * 60,
      ...(options.deadLetter ? { deadLetter: options.deadLetter } : {}),
    }
    if (await this.boss.getQueue(name)) await this.boss.updateQueue(name, queue)
    else await this.boss.createQueue(name, { ...queue, policy: options.policy ?? 'standard' })
  }

  send<N extends JobName>(name: N, data: JobPayloads[N], options: SendOptions = {}) {
    return this.boss.send(name, data, {
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
    })
  }

  async work<N extends JobName>(
    name: N,
    handler: (jobs: Job<N>[]) => Promise<void>,
    options: WorkOptions = {},
  ) {
    await this.boss.work<JobPayloads[N]>(
      name,
      {
        batchSize: options.batchSize ?? 1,
        localConcurrency: options.concurrency ?? 1,
        pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
      },
      (jobs) => handler(jobs.map((j) => ({ ...j, name }))),
    )
  }

  async schedule<N extends JobName>(name: N, cron: string, data: JobPayloads[N]) {
    await this.boss.schedule(name, cron, data, { tz: 'Europe/Paris' })
  }

  async stats(): Promise<QueueStat[]> {
    const queues = await this.boss.getQueues()
    return queues.map((q) => ({
      name: q.name,
      queued: q.queuedCount,
      ready: q.readyCount,
      active: q.activeCount,
      deferred: q.deferredCount,
      failed: q.failedCount,
      total: q.totalCount,
    }))
  }
}
