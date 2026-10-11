import { Elysia, t } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { PipelineModel } from './model.ts'
import type { PipelineService } from './service.ts'

/** The ingestion pipeline, seen from the admin: what is flowing, what is stuck, and the levers. */
export const pipelineModule = (auth: Auth, service: PipelineService) =>
  new Elysia({ name: 'module.pipeline', prefix: '/api/staff/pipeline' })
    .use(authPlugin(auth))
    .get('/overview', () => service.overview(), {
      staff: { pipeline: ['view'] },
      response: { 200: PipelineModel.overview },
      detail: {
        tags: ['staff'],
        summary: 'Items by state, the 24-hour funnel, queues and source health',
      },
    })
    .get('/events', ({ query }) => service.events(query), {
      staff: { pipeline: ['view'] },
      query: PipelineModel.eventsQuery,
      response: { 200: t.Array(PipelineModel.event) },
      detail: {
        tags: ['staff'],
        summary: 'Recent pipeline events, newest first (use `after` to tail)',
      },
    })
    .get('/items', ({ query }) => service.items(query), {
      staff: { pipeline: ['view'] },
      query: PipelineModel.itemsQuery,
      response: { 200: t.Array(PipelineModel.item) },
      detail: { tags: ['staff'], summary: 'Items, e.g. one lane (failed, unreadable, deferred)' },
    })
    .get('/throughput', ({ query }) => service.throughput(query.hours ?? 24), {
      staff: { pipeline: ['view'] },
      query: PipelineModel.throughputQuery,
      detail: { tags: ['staff'], summary: 'Events per hour, stage and outcome' },
    })
    .post('/retry', ({ body, staff }) => service.retry(body, staff), {
      staff: { pipeline: ['operate'] },
      body: PipelineModel.retry,
      response: { 200: t.Object({ retried: t.Number() }) },
      detail: {
        tags: ['staff'],
        summary: 'Put failed or unreadable items back where they stopped',
      },
    })
    .post('/operations', ({ body, staff }) => service.operation(body, staff), {
      staff: { pipeline: ['operate'] },
      body: PipelineModel.operation,
      response: { 200: PipelineModel.operationResult, 422: t.String() },
      detail: {
        tags: ['staff'],
        summary:
          'Backfill, re-extract, re-judge or re-match collected data (dry run unless dryRun=false)',
      },
    })
    .post('/run', ({ staff }) => service.runNow(staff), {
      staff: { pipeline: ['operate'] },
      response: { 200: t.Object({ queued: t.Boolean() }) },
      detail: { tags: ['staff'], summary: 'Read every due source and run every stage now' },
    })
