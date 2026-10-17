/**
 * What the pipeline reports about itself, in three places at once:
 *  - a `pipeline_events` row (the admin live view, funnel and history read these),
 *  - an event on the active OpenTelemetry span (Grafana, when configured),
 *  - a throttled "something happened" signal on the realtime bus.
 * Reporting never fails the stage that reports.
 */
import { schema, type Database } from '@manifeste/db'
import { trace } from '@opentelemetry/api'
import type { Stage } from '@manifeste/core'
import type { Logger } from '../logger.ts'
import type { EventBus } from '../realtime/bus.ts'

export interface PipelineEvent {
  stage: Stage | 'media' | 'routes' | 'run' | 'job'
  /** ok | skipped | deferred | failed, or the specific outcome (irrelevant, duplicate, reported…). */
  outcome: string
  runId?: string | null
  sourceId?: string | null
  itemId?: string | null
  durationMs?: number
  detail?: Record<string, unknown>
}

const tracer = trace.getTracer('manifeste.ingest')

/** Runs `fn` in a span named for the stage; the span is a no-op when tracing is off. */
export function inSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn()
    } catch (e) {
      span.recordException(e instanceof Error ? e : new Error(String(e)))
      span.setStatus({ code: 2, message: e instanceof Error ? e.message : String(e) })
      throw e
    } finally {
      span.end()
    }
  })
}

export class PipelineEvents {
  private lastSignal = 0

  constructor(
    private readonly db: Database,
    private readonly bus: EventBus | null,
    private readonly log: Logger,
    /** At most one realtime signal per this many ms. */
    private readonly signalEveryMs = 1000,
  ) {}

  async emit(...events: PipelineEvent[]): Promise<void> {
    if (events.length === 0) return
    const span = trace.getActiveSpan()
    const traceId = span?.spanContext().traceId
    for (const e of events)
      span?.addEvent(`${e.stage}.${e.outcome}`, {
        ...(e.itemId && { item: e.itemId }),
        ...(e.sourceId && { source: e.sourceId }),
      })
    try {
      await this.db.insert(schema.pipelineEvents).values(
        events.map((e) => ({
          stage: e.stage,
          outcome: e.outcome,
          runId: e.runId ?? null,
          sourceId: e.sourceId ?? null,
          itemId: e.itemId ?? null,
          durationMs: e.durationMs === undefined ? null : Math.round(e.durationMs),
          detail: e.detail ?? null,
          traceId: traceId && traceId !== '00000000000000000000000000000000' ? traceId : null,
        })),
      )
    } catch (e) {
      this.log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'pipeline events not stored',
      )
    }
    this.signal(events[events.length - 1] as PipelineEvent)
  }

  private signal(last: PipelineEvent): void {
    const now = Date.now()
    if (!this.bus || now - this.lastSignal < this.signalEveryMs) return
    this.lastSignal = now
    void this.bus
      .publish({ topic: 'pipeline', data: { stage: last.stage, outcome: last.outcome } })
      .catch(() => {})
  }
}
