import { Elysia, t } from 'elysia'
import { SchoolsModel } from './model.ts'
import type { SchoolsService } from './service.ts'

/** The directory is stable: browsers and the CDN may keep a school's details for a day. */
const DIRECTORY_CACHE = 'public, max-age=3600, s-maxage=86400'
const REPORTS_CACHE = 'public, max-age=30, s-maxage=60'

export const schoolsModule = (service: SchoolsService) =>
  new Elysia({ name: 'module.schools', prefix: '/api/schools' })
    // Fixed paths first: `/nearby` must not be read as a UAI.
    .get('/nearby', ({ query }) => service.nearby(query.lat, query.lng, query.radiusM), {
      query: SchoolsModel.nearbyQuery,
      response: t.Array(SchoolsModel.nearby),
      detail: { tags: ['schools'], summary: 'Schools within a radius of a position' },
    })
    .get(
      '/search',
      async ({ query, set }) => {
        set.headers['cache-control'] = DIRECTORY_CACHE
        return service.search(query.q)
      },
      {
        query: SchoolsModel.searchQuery,
        response: t.Array(SchoolsModel.hit),
        detail: { tags: ['schools'], summary: 'Search schools by name and city' },
      },
    )
    .get(
      '/:uai',
      async ({ params, set, status }) => {
        const school = await service.detail(params.uai)
        if (!school) return status(404, 'School not found')
        set.headers['cache-control'] = DIRECTORY_CACHE
        return school
      },
      {
        params: SchoolsModel.uaiParams,
        response: { 200: SchoolsModel.detail, 404: t.String() },
        detail: { tags: ['schools'], summary: 'One school of the directory' },
      },
    )
    .get(
      '/:uai/reports',
      async ({ params, query, set }) => {
        set.headers['cache-control'] = REPORTS_CACHE
        return service.reports(params.uai, query.days)
      },
      {
        params: SchoolsModel.uaiParams,
        query: SchoolsModel.historyQuery,
        response: t.Array(SchoolsModel.report),
        detail: {
          tags: ['schools'],
          summary: 'Validated reports of a school over the last days (1 to 7)',
        },
      },
    )
