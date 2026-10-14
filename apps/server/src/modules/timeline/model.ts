import { t } from 'elysia'
import { PERIODS, REPORT_STATUSES, SCHOOL_LEVELS } from '@manifeste/core'

export const TimelineModel = {
  query: t.Object({ period: t.UnionEnum([...PERIODS], { default: 'all' }) }),
  response: t.Object({
    /** Only the schools that appear in `events`. */
    schools: t.Array(
      t.Object({
        uai: t.String(),
        name: t.String(),
        city: t.String(),
        department: t.Nullable(t.String()),
        academy: t.Nullable(t.String()),
        lat: t.Nullable(t.Number()),
        lng: t.Nullable(t.Number()),
        level: t.UnionEnum([...SCHOOL_LEVELS]),
      }),
    ),
    /** Oldest to newest. */
    events: t.Array(
      t.Object({
        uai: t.String(),
        status: t.UnionEnum([...REPORT_STATUSES]),
        /** Time of the fact, milliseconds since 1970. */
        at: t.Number(),
        /** One source counts for one, however many articles. */
        sourceKey: t.String(),
        /** Reported mobilisation (judge tiers on): not part of the counted statuses. */
        mobilisation: t.Boolean(),
      }),
    ),
  }),
} as const

export type Timeline = typeof TimelineModel.response.static
