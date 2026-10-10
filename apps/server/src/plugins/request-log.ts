import { Elysia } from 'elysia'
import type { Logger } from '../logger.ts'

/** One structured line per API request (health probes excluded). */
export const requestLog = (log: Logger) =>
  new Elysia({ name: 'request-log' })
    .derive({ as: 'global' }, () => ({ startedAt: performance.now() }))
    // `path` rather than `request.url`: once better-auth has handled a request, its url is empty.
    .onAfterResponse({ as: 'global' }, ({ path, request, set, startedAt }) => {
      if (!path.startsWith('/api/') || path.startsWith('/api/health')) return
      log.info(
        {
          method: request.method,
          path,
          status: typeof set.status === 'number' ? set.status : 200,
          ms: Math.round(performance.now() - (startedAt ?? performance.now())),
        },
        'request',
      )
    })
