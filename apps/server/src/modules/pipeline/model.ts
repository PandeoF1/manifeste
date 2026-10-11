import { t } from 'elysia'
import { ITEM_STATES, STAGES } from '@manifeste/core'
import { OPERATION_KINDS } from '../../ingest/operations.ts'

export const PipelineModel = {
  eventsQuery: t.Object({
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500, default: 100 })),
    stage: t.Optional(t.String()),
    /** Only events with an id above this (live tail). */
    after: t.Optional(t.Numeric()),
    sourceId: t.Optional(t.String({ format: 'uuid' })),
  }),
  event: t.Object({
    id: t.Number(),
    at: t.Date(),
    stage: t.String(),
    outcome: t.String(),
    sourceId: t.Nullable(t.String()),
    itemId: t.Nullable(t.String()),
    runId: t.Nullable(t.String()),
    durationMs: t.Nullable(t.Number()),
    detail: t.Nullable(t.Unknown()),
    traceId: t.Nullable(t.String()),
  }),
  itemsQuery: t.Object({
    state: t.Optional(t.UnionEnum([...ITEM_STATES])),
    sourceId: t.Optional(t.String({ format: 'uuid' })),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, default: 50 })),
  }),
  item: t.Object({
    id: t.String(),
    sourceId: t.String(),
    source: t.String(),
    url: t.String(),
    state: t.UnionEnum([...ITEM_STATES]),
    reason: t.Nullable(t.String()),
    attempts: t.Number(),
    publishedAt: t.Date(),
    discoveredAt: t.Date(),
    updatedAt: t.Date(),
  }),
  retry: t.Object({
    itemIds: t.Optional(t.Array(t.String({ format: 'uuid' }), { maxItems: 500 })),
    sourceId: t.Optional(t.String({ format: 'uuid' })),
    states: t.Optional(t.Array(t.Union([t.Literal('failed'), t.Literal('unreadable')]))),
  }),
  /** One shape for every operation; the service checks what each needs. Dry run unless told otherwise. */
  operation: t.Object({
    kind: t.UnionEnum([...OPERATION_KINDS]),
    sinceHours: t.Optional(t.Integer({ minimum: 1, maximum: 8760 })),
    sourceId: t.Optional(t.String({ format: 'uuid' })),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 5000 })),
    useAi: t.Optional(t.Boolean()),
    dryRun: t.Optional(t.Boolean({ default: true })),
  }),
  operationResult: t.Union([
    t.Object({
      kind: t.UnionEnum([...OPERATION_KINDS]),
      dryRun: t.Boolean(),
      summary: t.Record(t.String(), t.Union([t.String(), t.Number()])),
    }),
    t.Object({ queued: t.Boolean() }),
  ]),
  throughputQuery: t.Object({
    hours: t.Optional(t.Numeric({ minimum: 1, maximum: 168, default: 24 })),
  }),
  overview: t.Object({
    /** Items by state, over the last 7 days. */
    states: t.Record(t.String(), t.Number()),
    /** What the last 24 hours did, stage by stage: `stage` → `outcome` → count. */
    stages: t.Record(t.String(), t.Record(t.String(), t.Number())),
    /** The funnel of the last 24 hours. */
    funnel: t.Object({
      discovered: t.Number(),
      relevant: t.Number(),
      read: t.Number(),
      extracted: t.Number(),
      facts: t.Number(),
      reported: t.Number(),
      unmatched: t.Number(),
    }),
    sources: t.Record(t.String(), t.Number()),
    queues: t.Array(
      t.Object({
        name: t.String(),
        queued: t.Number(),
        active: t.Number(),
        deferred: t.Number(),
        failed: t.Number(),
      }),
    ),
    stagesKnown: t.Array(t.String()),
  }),
} as const

export const KNOWN_STAGES = [...STAGES]
