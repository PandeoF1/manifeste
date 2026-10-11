import { t } from 'elysia'
import { optionalEnum } from '../../lib/typebox.ts'
import {
  CERTAINTIES,
  MODERATION_STATES,
  REPORT_ORIGINS,
  REPORT_STATUSES,
  TIERS,
} from '@manifeste/core'

const status = t.UnionEnum([...REPORT_STATUSES])
const origin = t.UnionEnum([...REPORT_ORIGINS])
const moderation = t.UnionEnum([...MODERATION_STATES])

export const ModerationModel = {
  id: t.Object({ id: t.String({ format: 'uuid' }) }),
  /** A report waiting for a human. Moderators get no position and no internal source. */
  pending: t.Object({
    id: t.String(),
    schoolUai: t.String(),
    schoolName: t.Nullable(t.String()),
    schoolCity: t.Nullable(t.String()),
    status,
    origin,
    observedAt: t.Date(),
    sourceUrl: t.Nullable(t.String()),
    sourceDomain: t.Nullable(t.String()),
    /** Admins only. */
    sourceLabel: t.Nullable(t.String()),
    certainty: t.Nullable(t.UnionEnum([...CERTAINTIES])),
    /** Metres from the school, for an on-site report. */
    distanceM: t.Nullable(t.Integer()),
    hasPhoto: t.Boolean(),
    judge: t.Nullable(
      t.Object({ probability: t.Nullable(t.Number()), nature: t.Nullable(t.String()) }),
    ),
    tier: t.UnionEnum([...TIERS]),
  }),
  listQuery: t.Object({
    moderation: optionalEnum(MODERATION_STATES),
    hidden: t.Optional(t.BooleanString()),
    q: t.Optional(t.String({ maxLength: 80 })),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500, default: 300 })),
  }),
  report: t.Object({
    id: t.String(),
    schoolUai: t.String(),
    schoolName: t.Nullable(t.String()),
    schoolCity: t.Nullable(t.String()),
    status,
    origin,
    moderation,
    hidden: t.Boolean(),
    observedAt: t.Date(),
    sourceUrl: t.Nullable(t.String()),
    sourceDomain: t.Nullable(t.String()),
    sourceLabel: t.Nullable(t.String()),
    certainty: t.Nullable(t.UnionEnum([...CERTAINTIES])),
    tier: t.UnionEnum([...TIERS]),
    hasPhoto: t.Boolean(),
    createdAt: t.Date(),
  }),
  decision: t.Object({
    decision: t.UnionEnum(['approve', 'reject']),
    /** The blurred JPEG staff chose to publish (approve only). */
    photo: t.Optional(t.File({ type: ['image/jpeg', 'image/webp'] })),
  }),
  patch: t.Object({
    schoolUai: t.Optional(t.String({ pattern: '^[0-9]{7}[A-Z]$' })),
    status: t.Optional(status),
    observedAt: t.Optional(t.Date()),
    moderation: optionalEnum(MODERATION_STATES),
  }),
  hidden: t.Object({ hidden: t.Boolean() }),
} as const
