import { Elysia } from 'elysia'
import type { Logger } from '../logger.ts'

/** One structured line per API request (health probes excluded). */
export const requestLog = (log: Logger) =>
  new Elysia({ name: 'request-log' })
    .derive({ as: 'global' }, () => ({ startedAt: performance.now() }))
    .onAfterResponse({ as: 'global' }, ({ request, set, startedAt }) => {
      const { pathname } = new URL(request.url)
      if (!pathname.startsWith('/api/') || pathname.startsWith('/api/health')) return
      log.info(
        {
          method: request.method,
          path: pathname,
          status: typeof set.status === 'number' ? set.status : 200,
          ms: Math.round(performance.now() - (startedAt ?? performance.now())),
        },
        'request',
      )
    })
