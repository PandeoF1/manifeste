import { sql } from 'drizzle-orm'
import { migrationStatus, type Database } from '@manifeste/db'
import type { JobQueue } from '../../queue/queue.ts'
import type { Check, Readiness } from './model.ts'

export class HealthService {
  constructor(
    private readonly db: Database,
    private readonly queue: JobQueue,
    private readonly role: string,
    private readonly version: string,
  ) {}

  live() {
    return { status: 'ok' as const, role: this.role, version: this.version }
  }

  /** Ready = the database answers, its schema matches this build and the queue is running. */
  async ready(): Promise<Readiness> {
    const [database, migrations] = await Promise.all([this.database(), this.migrations()])
    const queue: Check = this.queue.isStarted()
      ? { ok: true }
      : { ok: false, detail: 'queue not started' }
    const ok = database.ok && migrations.ok && queue.ok
    return {
      status: ok ? 'ready' : 'not_ready',
      role: this.role,
      version: this.version,
      checks: { database, migrations, queue },
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
