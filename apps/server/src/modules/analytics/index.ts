import { Elysia } from 'elysia'
import { clientIp } from '../../lib/client-ip.ts'
import { AnalyticsModel } from './model.ts'
import { isBot, MAX_BEACON_BYTES, type AnalyticsService } from './service.ts'

const noContent = () => new Response(null, { status: 204 })

/**
 * Anonymous statistics endpoints. They always answer 204: a client never learns whether it was
 * counted, and a failure here must never disturb the page.
 */
export const analyticsModule = (service: AnalyticsService) =>
  new Elysia({ name: 'module.analytics', prefix: '/api/analytics' })
    .post(
      '/beacon',
      async ({ body, request, server }) => {
        const length = Number(request.headers.get('content-length') ?? 0)
        if (
          isBot(request.headers.get('user-agent')) ||
          length > MAX_BEACON_BYTES ||
          request.headers.get('dnt') === '1' ||
          request.headers.get('sec-gpc') === '1'
        )
          return noContent()
        await service.record(clientIp(request.headers, server?.requestIP(request)?.address), body)
        return noContent()
      },
      {
        body: AnalyticsModel.beacon,
        detail: { tags: ['analytics'], summary: 'Page view and web vitals (anonymous)' },
      },
    )
    .post(
      '/ping',
      async ({ body, request }) => {
        if (isBot(request.headers.get('user-agent'))) return noContent()
        await service.ping(body.session, body.page)
        return noContent()
      },
      {
        body: AnalyticsModel.ping,
        detail: { tags: ['analytics'], summary: '"Tab open" signal (anonymous)' },
      },
    )
