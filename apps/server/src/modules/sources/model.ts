import { t } from 'elysia'
import { SOURCE_KINDS } from '@manifeste/db'

const origin = t.Union([t.Literal('press'), t.Literal('union'), t.Literal('aggregator')])
const health = t.Union([t.Literal('closed'), t.Literal('open'), t.Literal('half_open')])

export const SourcesModel = {
  create: t.Object({
    kind: t.UnionEnum([...SOURCE_KINDS]),
    identifier: t.String({ minLength: 1, maxLength: 500 }),
    label: t.String({ minLength: 1, maxLength: 120 }),
    origin,
    trusted: t.Boolean(),
  }),
  patch: t.Object({
    label: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
    origin: t.Optional(origin),
    trusted: t.Optional(t.Boolean()),
    enabled: t.Optional(t.Boolean()),
    reportsHidden: t.Optional(t.Boolean()),
  }),
  source: t.Object({
    id: t.String(),
    kind: t.UnionEnum([...SOURCE_KINDS]),
    identifier: t.String(),
    label: t.String(),
    origin,
    trusted: t.Boolean(),
    enabled: t.Boolean(),
    reportsHidden: t.Boolean(),
    health,
    consecutiveFailures: t.Number(),
    nextAttemptAt: t.Nullable(t.Date()),
    lastRunAt: t.Nullable(t.Date()),
    lastSuccessAt: t.Nullable(t.Date()),
    lastError: t.Nullable(t.String()),
    stats: t.Object({
      items24h: t.Number(),
      relevant24h: t.Number(),
      reports7d: t.Number(),
    }),
  }),
  preset: t.Object({
    group: t.String(),
    kind: t.UnionEnum([...SOURCE_KINDS]),
    identifier: t.String(),
    label: t.String(),
    origin,
    trusted: t.Boolean(),
  }),
  id: t.Object({ id: t.String({ format: 'uuid' }) }),
} as const
