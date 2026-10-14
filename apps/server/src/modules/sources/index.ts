import { Elysia, t } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { SourcesModel } from './model.ts'
import type { SourcesService } from './service.ts'

/** Sources to collect from: add, tune, pause, read now (admins). */
export const sourcesModule = (auth: Auth, service: SourcesService) =>
  new Elysia({ name: 'module.sources', prefix: '/api/staff/sources' })
    .use(authPlugin(auth))
    .get('/', () => service.list(), {
      staff: { source: ['manage'] },
      response: { 200: t.Array(SourcesModel.source) },
      detail: { tags: ['staff'], summary: 'Sources with their health and recent activity' },
    })
    .get('/presets', () => service.presets(), {
      staff: { source: ['manage'] },
      response: { 200: t.Array(SourcesModel.preset) },
      detail: { tags: ['staff'], summary: 'Ready-made sources not added yet' },
    })
    .post('/', ({ body, staff }) => service.create(body, staff), {
      staff: { source: ['manage'] },
      body: SourcesModel.create,
      response: { 200: SourcesModel.source, 409: t.String(), 422: t.String(), 500: t.String() },
      detail: {
        tags: ['staff'],
        summary: 'Add a source (its identifier is checked and normalised)',
      },
    })
    .patch('/:id', ({ params, body, staff }) => service.update(params.id, body, staff), {
      staff: { source: ['manage'] },
      params: SourcesModel.id,
      body: SourcesModel.patch,
      response: { 200: SourcesModel.source, 404: t.String() },
      detail: { tags: ['staff'], summary: 'Change a source' },
    })
    .delete('/:id', ({ params, staff }) => service.remove(params.id, staff), {
      staff: { source: ['manage'] },
      params: SourcesModel.id,
      detail: { tags: ['staff'], summary: 'Delete a source and everything it collected' },
    })
    .post('/:id/run', ({ params, staff }) => service.run(params.id, staff), {
      staff: { source: ['manage'] },
      params: SourcesModel.id,
      response: { 200: t.Object({ queued: t.Boolean() }), 404: t.String() },
      detail: { tags: ['staff'], summary: 'Read a source now' },
    })
    .post('/:id/reset-health', ({ params, staff }) => service.resetHealth(params.id, staff), {
      staff: { source: ['manage'] },
      params: SourcesModel.id,
      response: { 200: SourcesModel.source, 404: t.String() },
      detail: { tags: ['staff'], summary: 'Close the circuit breaker of a source' },
    })
    .get('/:id/runs', ({ params }) => service.runs(params.id), {
      staff: { source: ['manage'] },
      params: SourcesModel.id,
      detail: { tags: ['staff'], summary: 'Recent reads of a source' },
    })
