import { Elysia } from 'elysia'
import { TimelineModel } from './model.ts'
import type { TimelineService } from './service.ts'

export const timelineModule = (service: TimelineService) =>
  new Elysia({ name: 'module.timeline', prefix: '/api/timeline' }).get(
    '/',
    ({ query, set }) => {
      set.headers['cache-control'] = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
      return service.get(query.period)
    },
    {
      query: TimelineModel.query,
      response: TimelineModel.response,
      detail: {
        tags: ['statuses'],
        summary: 'Every visible report of a period, to replay the map over time',
      },
    },
  )
