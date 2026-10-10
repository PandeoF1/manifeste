/**
 * Job registrations for processes with ROLE=worker or ROLE=all.
 * Phase 1 only runs a heartbeat that proves the worker and its cron are alive.
 */
import type { AppContext } from './context.ts'

export async function startWorker(ctx: AppContext): Promise<void> {
  const { queue, log } = ctx
  await queue.define('system.heartbeat', {
    retryLimit: 0,
    expireInSeconds: 60,
    policy: 'exclusive',
  })
  await queue.work('system.heartbeat', async () => {
    log.debug('heartbeat')
  })
  await queue.schedule('system.heartbeat', '* * * * *', {})
  log.info('worker started')
}
