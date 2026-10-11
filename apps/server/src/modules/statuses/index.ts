import { Elysia, t } from 'elysia'
import { StatusesModel } from './model.ts'
import type { StatusesService } from './service.ts'

/** Cache headers for the polled lists: the server also caches them for 30 s. */
const CACHE = 'public, max-age=15, s-maxage=30, stale-while-revalidate=60'

/** What the map and the list show: counted statuses and reported mobilisations. */
export const statusesModule = (service: StatusesService) =>
  new Elysia({ name: 'module.statuses', prefix: '/api/statuses' })
    .get(
      '/',
      ({ query, set }) => {
        set.headers['cache-control'] = CACHE
        return service.current(query.period)
      },
      {
        query: t.Object({ period: StatusesModel.period }),
        response: t.Array(StatusesModel.schoolStatus),
        detail: {
          tags: ['statuses'],
          summary: 'Schools blocked, filtering or lifted, live or over a period',
        },
      },
    )
    .get(
      '/mobilisation',
      ({ query, set }) => {
        set.headers['cache-control'] = CACHE
        return service.mobilisation(query.period)
      },
      {
        query: t.Object({ period: StatusesModel.period }),
        response: t.Array(StatusesModel.schoolStatus),
        detail: {
          tags: ['statuses'],
          summary: 'Schools with only a reported mobilisation (judge tiers on)',
        },
      },
    )
