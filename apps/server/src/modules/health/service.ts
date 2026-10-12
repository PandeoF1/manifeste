import { sql } from 'drizzle-orm'
import { migrationStatus, type Database } from '@manifeste/db'
import { memoWithTtl } from '../../lib/memo.ts'
import type { JobQueue } from '../../queue/queue.ts'
import type { BlobStore } from '../../storage/blob-store.ts'
import type { Check, Readiness } from './model.ts'

export interface HealthOptions {
  /** The storage answer is reused this long: monitors poll often and a bucket call costs money. */
  photosCacheMs?: number
  /** A storage that does not answer in this time is reported as failing. */
  photosTimeoutMs?: number
}

export class HealthService {
  private readonly photosCheck: ReturnType<typeof memoWithTtl<'photos', Check>>
  private readonly photosTimeoutMs: number

  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly role: string,
    private readonly version: string,
    private readonly blobs: BlobStore,
    options: HealthOptions = {},
  ) {
    this.photosTimeoutMs = options.photosTimeoutMs ?? 3000
    this.photosCheck = memoWithTtl(options.photosCacheMs ?? 30_000, () => this.photos())
  }

  live() {
    return { status: 'ok' as const, role: this.role, version: this.version }
  }

  /**
   * Ready = the database answers, its schema matches this build and the queue is running.
   * The photo storage is reported too but does not decide: without photos the map, the lists and
   * the data still work, and answering 503 would make the orchestrator pull the whole site.
   */
  async ready(): Promise<Readiness> {
    const [database, migrations, photos] = await Promise.all([
      this.database(),
      this.migrations(),
      this.photosCheck.get('photos'),
    ])
    const queue: Check = this.queue.isStarted()
      ? { ok: true }
      : { ok: false, detail: 'queue not started' }
    const ok = database.ok && migrations.ok && queue.ok
    return {
      status: ok ? 'ready' : 'not_ready',
      role: this.role,
      version: this.version,
      checks: { database, migrations, queue, photos },
      degraded: photos.ok ? [] : ['photos'],
    }
  }

  private async photos(): Promise<Check> {
    const started = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.blobs.probe('read'),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`no answer in ${this.photosTimeoutMs} ms`)),
            this.photosTimeoutMs,
          )
        }),
      ])
      return { ok: true, latencyMs: Math.round(performance.now() - started) }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  private async database(): Promise<Check> {
    const started = performance.now()
    try {
      await this.db.execute(sql`select 1`)
      return { ok: true, latencyMs: Math.round(performance.now() - started) }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  private async migrations(): Promise<Check> {
    try {
      const s = await migrationStatus(this.db)
      return s.upToDate
        ? { ok: true }
        : { ok: false, detail: `${s.applied}/${s.expected} migrations applied` }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }
}
