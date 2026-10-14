/**
 * Events between processes, over Postgres LISTEN/NOTIFY: the worker (or any API instance)
 * publishes, every API instance forwards to the WebSocket clients it holds. No Redis, and it
 * keeps working unchanged with several API instances.
 *
 * Payloads are tiny signals ("something changed, refetch"), never data: NOTIFY is limited to
 * 8 kB and a missed message is harmless (clients also poll).
 */
import { sql } from 'drizzle-orm'
import pg from 'pg'
import type { Database } from '@manifeste/db'
import type { Logger } from '../logger.ts'

export const CHANNEL = 'manifeste_events'

/** Topics: `statuses` is public, the others are for staff. */
export const TOPICS = ['statuses', 'moderation', 'pipeline'] as const
export type Topic = (typeof TOPICS)[number]
export const PUBLIC_TOPICS: readonly Topic[] = ['statuses']

export interface BusEvent {
  topic: Topic
  /** Small, JSON-friendly hints (a UAI, a stage name…). */
  data?: Record<string, string | number | boolean | null>
}

type Listener = (event: BusEvent) => void

const isTopic = (v: unknown): v is Topic =>
  typeof v === 'string' && (TOPICS as readonly string[]).includes(v)

export class EventBus {
  private readonly listeners = new Set<Listener>()
  private client: pg.Client | null = null
  private stopped = true
  private retry: ReturnType<typeof setTimeout> | null = null
  private attempts = 0

  constructor(
    private readonly connectionString: string,
    private readonly db: Database,
    private readonly log: Logger,
  ) {}

  /** Tells every API instance (this one included) that something changed. */
  async publish(event: BusEvent): Promise<void> {
    await this.db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(event)})`)
  }

  /** Calls `fn` for each event received; returns the unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async start(): Promise<void> {
    this.stopped = false
    await this.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    const client = this.client
    this.client = null
    await client?.end().catch(() => {})
  }

  isListening(): boolean {
    return this.client !== null
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.connectionString,
      application_name: 'manifeste-events',
    })
    client.on('notification', (msg) => this.dispatch(msg.payload))
    const lost = (error?: Error) => {
      if (this.client !== client) return
      this.client = null
      if (error) this.log.warn({ err: error.message }, 'event bus connection lost')
      this.scheduleReconnect()
    }
    client.on('error', lost)
    client.on('end', () => lost())
    try {
      await client.connect()
      await client.query(`listen ${CHANNEL}`)
      this.client = client
      this.attempts = 0
    } catch (error) {
      await client.end().catch(() => {})
      this.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'event bus cannot listen',
      )
      this.scheduleReconnect()
    }
  }

  /** Back off from 1 s to 30 s: the clients poll in the meantime, nothing is lost for good. */
  private scheduleReconnect(): void {
    if (this.stopped || this.retry) return
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts++)
    this.retry = setTimeout(() => {
      this.retry = null
      void this.connect()
    }, delay)
  }

  private dispatch(payload: string | undefined): void {
    let event: unknown
    try {
      event = JSON.parse(payload ?? '')
    } catch {
      return
    }
    if (!event || typeof event !== 'object' || !isTopic((event as BusEvent).topic)) return
    for (const fn of this.listeners) {
      try {
        fn(event as BusEvent)
      } catch (error) {
        this.log.error(
          { err: error instanceof Error ? error.message : String(error) },
          'bus listener failed',
        )
      }
    }
  }
}
