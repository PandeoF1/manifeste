/**
 * Job registrations for processes with ROLE=worker or ROLE=all: a heartbeat that proves the
 * worker and its cron are alive, and the analytics housekeeping. Ingestion stages join later.
 */
import type { AppContext } from './context.ts'
import { AnalyticsService } from './modules/analytics/service.ts'

export async function startWorker(ctx: AppContext): Promise<void> {
  const { queue, log } = ctx
  const analytics = new AnalyticsService(ctx.db)
  await queue.define('system.heartbeat', {
    retryLimit: 0,
    expireInSeconds: 60,
    policy: 'exclusive',
  })
  await queue.work('system.heartbeat', async () => {
    log.debug('heartbeat')
  })
  await queue.schedule('system.heartbeat', '* * * * *', {})

  await queue.define('analytics.snapshot-online', {
    retryLimit: 0,
    expireInSeconds: 60,
    policy: 'exclusive',
  })
  await queue.work('analytics.snapshot-online', () => analytics.snapshotOnline())
  await queue.schedule('analytics.snapshot-online', '* * * * *', {})

  // Shortly after midnight in Paris: yesterday's hashes and salts are destroyed.
  await queue.define('analytics.rollup', { retryLimit: 5, policy: 'exclusive' })
  await queue.work('analytics.rollup', () => analytics.rollup())
  await queue.schedule('analytics.rollup', '5 0 * * *', {})
  log.info('worker started')
}
