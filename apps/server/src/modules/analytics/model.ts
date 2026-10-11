import { t } from 'elysia'
import { ANALYTICS_PAGES, WEB_VITALS } from '@manifeste/db'

const page = t.UnionEnum([...ANALYTICS_PAGES])

export const AnalyticsModel = {
  beacon: t.Object({
    page,
    /** Count a page view (false = metrics only, sent when the tab closes). */
    view: t.Boolean({ default: true }),
    metrics: t.Array(t.Object({ name: t.UnionEnum([...WEB_VITALS]), value: t.Number() }), {
      maxItems: 12,
      default: [],
    }),
  }),
  ping: t.Object({ session: t.String({ format: 'uuid' }), page }),
} as const
