import { Elysia } from 'elysia'
import { HealthModel } from './model.ts'
import type { HealthService } from './service.ts'

/** Liveness (process up) and readiness (dependencies OK) probes for Coolify and the uptime check. */
export const healthModule = (service: HealthService) =>
  new Elysia({ name: 'module.health', prefix: '/api/health' })
    .get('/live', () => service.live(), {
      response: HealthModel.live,
      detail: { tags: ['health'], summary: 'Liveness probe' },
    })
    .get(
      '/ready',
      async ({ set }) => {
        const result = await service.ready()
        set.headers['cache-control'] = 'no-store'
        if (result.status !== 'ready') set.status = 503
        return result
      },
      {
        response: { 200: HealthModel.ready, 503: HealthModel.ready },
        detail: { tags: ['health'], summary: 'Readiness probe' },
      },
    )
