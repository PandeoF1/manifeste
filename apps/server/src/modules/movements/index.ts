import { Elysia, status, t } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { audit } from '../../lib/audit.ts'
import { MovementsModel } from './model.ts'
import type { SettingsService } from '../settings/service.ts'
import { MovementError, type MovementsService } from './service.ts'

/** Public pages change rarely: a short browser cache, a longer one at the edge. */
const CACHE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300'

/** The service's failures become HTTP statuses; anything else stays a 500. */
const guard = async <T>(run: () => Promise<T>) => {
  try {
    return await run()
  } catch (e) {
    if (!(e instanceof MovementError)) throw e
    // One literal status per branch: Elysia checks each against the route's response schemas.
    if (e.code === 'not_found') return status(404, e.message)
    if (e.code === 'conflict') return status(409, e.message)
    return status(422, e.message)
  }
}

const oneMovement = t.Object({
  movement: MovementsModel.movement,
  events: t.Array(MovementsModel.event),
})

/**
 * Public: the movements (active, then archives) and one movement with its events and routes.
 * Hidden (404, as if the pages did not exist) until the `movements_public` setting is on.
 */
export const movementsModule = (service: MovementsService, settings: SettingsService) =>
  new Elysia({ name: 'module.movements', prefix: '/api/movements' })
    .get(
      '/',
      async ({ set }) => {
        if (!(await settings.all()).movements_public) return status(404, 'Not found')
        set.headers['cache-control'] = CACHE
        return service.list()
      },
      {
        response: { 200: t.Array(MovementsModel.movement), 404: t.String() },
        detail: { tags: ['movements'], summary: 'Movements: the active ones, then the archives' },
      },
    )
    .get(
      '/:slug',
      async ({ params, set }) => {
        if (!(await settings.all()).movements_public) return status(404, 'Not found')
        const found = await service.one(params.slug)
        if (!found) return status(404, 'Unknown movement')
        set.headers['cache-control'] = CACHE
        return found
      },
      {
        params: MovementsModel.slugParams,
        response: { 200: oneMovement, 404: t.String() },
        detail: {
          tags: ['movements'],
          summary: 'A movement with its published events (marches carry their route)',
        },
      },
    )

/**
 * Public: the approved marches with a route, close to now, for the home map. Empty until the
 * `marches_on_map` setting is on.
 */
export const marchesModule = (service: MovementsService, settings: SettingsService) =>
  new Elysia({ name: 'module.marches', prefix: '/api/marches' }).get(
    '/',
    async ({ query, set }) => {
      if (!(await settings.all()).marches_on_map) return []
      set.headers['cache-control'] = CACHE
      return service.marches(query.period ?? 'live')
    },
    {
      query: t.Object({ period: t.Optional(MovementsModel.period) }),
      response: t.Array(MovementsModel.event),
      detail: {
        tags: ['movements'],
        summary: 'Marches with a route of the active movements, for a period (home map)',
      },
    },
  )

/** Staff: create, archive and edit movements and their events. Every action is audited. */
export const movementsStaffModule = (
  auth: Auth,
  db: Parameters<typeof audit>[0],
  service: MovementsService,
) =>
  new Elysia({ name: 'module.movements.staff', prefix: '/api/staff' })
    .use(authPlugin(auth))
    .get('/movements', () => service.listForStaff(), {
      staff: { movement: ['manage'] },
      response: { 200: t.Array(MovementsModel.movement) },
      detail: {
        tags: ['staff'],
        summary: 'All movements (also while the public pages are hidden)',
      },
    })
    .post(
      '/movements',
      ({ body, staff }) =>
        guard(async () => {
          const created = await service.create(body)
          await audit(db, staff, 'movement.create', created.slug, null, created)
          return created
        }),
      {
        staff: { movement: ['manage'] },
        body: MovementsModel.createMovement,
        response: {
          200: MovementsModel.movement,
          404: t.String(),
          409: t.String(),
          422: t.String(),
        },
        detail: { tags: ['staff'], summary: 'Create a movement' },
      },
    )
    .patch(
      '/movements/:id',
      ({ params, body, staff }) =>
        guard(async () => {
          const { before, after } = await service.patch(params.id, body)
          await audit(db, staff, 'movement.update', after.slug, before, after)
          return { ok: true as const }
        }),
      {
        staff: { movement: ['manage'] },
        params: MovementsModel.idParams,
        body: MovementsModel.patchMovement,
        response: {
          200: t.Object({ ok: t.Literal(true) }),
          404: t.String(),
          409: t.String(),
          422: t.String(),
        },
        detail: { tags: ['staff'], summary: 'Edit, archive or reopen a movement' },
      },
    )
    .get('/movements/:id/events', ({ params }) => guard(() => service.eventsForStaff(params.id)), {
      staff: { movement: ['manage'] },
      params: MovementsModel.idParams,
      response: {
        200: t.Array(MovementsModel.staffEvent),
        404: t.String(),
        409: t.String(),
        422: t.String(),
      },
      detail: { tags: ['staff'], summary: 'All events of a movement, hidden ones included' },
    })
    .post(
      '/movements/:id/events',
      ({ params, body, staff }) =>
        guard(async () => {
          const created = await service.addEvent(params.id, body)
          await audit(db, staff, 'movement-event.create', created.id, null, created)
          return created
        }),
      {
        staff: { movement: ['manage'] },
        params: MovementsModel.idParams,
        body: MovementsModel.createEvent,
        response: { 200: MovementsModel.event, 404: t.String(), 409: t.String(), 422: t.String() },
        detail: { tags: ['staff'], summary: 'Add an event (march, rally, blockade) to a movement' },
      },
    )
    .patch(
      '/movement-events/:id',
      ({ params, body, staff }) =>
        guard(async () => {
          const { before, after } = await service.patchEvent(params.id, body)
          await audit(db, staff, 'movement-event.update', after.id, before, after)
          return { ok: true as const }
        }),
      {
        staff: { movement: ['manage'] },
        params: MovementsModel.idParams,
        body: MovementsModel.patchEvent,
        response: {
          200: t.Object({ ok: t.Literal(true) }),
          404: t.String(),
          409: t.String(),
          422: t.String(),
        },
        detail: { tags: ['staff'], summary: 'Edit, cancel, hide an event or change its route' },
      },
    )
