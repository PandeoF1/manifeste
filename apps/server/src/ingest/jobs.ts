/** Registers the pipeline on the job queue: one sweep per stage, one job per source. */
import type { AppContext } from '../context.ts'
import type { JobQueue } from '../queue/queue.ts'
import type { IngestService } from './service.ts'

/**
 * Creates the queues. Every process that may send jobs (the API too: "read this source now")
 * calls this at boot; creating an existing queue is a no-op.
 *
 * `stately`: one job waiting and one running per key. A request that arrives while a sweep runs
 * is kept for the next one instead of being lost.
 */
export async function defineIngestQueues(queue: JobQueue): Promise<void> {
  const sweep = { policy: 'stately', retryLimit: 2, expireInSeconds: 15 * 60 } as const
  for (const stage of ['read', 'extract', 'resolve'] as const)
    await queue.define(`ingest.${stage}`, sweep)
  await queue.define('ingest.discover', {
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 5 * 60,
  })
  await queue.define('ingest.tick', { policy: 'stately', retryLimit: 0, expireInSeconds: 120 })
  await queue.define('ingest.housekeeping', { policy: 'stately', retryLimit: 3 })
}

export async function registerIngestJobs(ctx: AppContext, ingest: IngestService): Promise<void> {
  const { queue, log } = ctx
  const { config } = ingest.deps
  await defineIngestQueues(queue)

  for (const stage of ['read', 'extract', 'resolve'] as const) {
    await queue.work(`ingest.${stage}`, async () => {
      // A sweep that left work behind asks for the next one itself.
      await ingest[stage]()
    })
  }

  await queue.define('ingest.discover', {
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 5 * 60,
  })
  await queue.work(
    'ingest.discover',
    async (jobs) => {
      for (const job of jobs) await ingest.discover(job.data.sourceId, job.data.trigger)
    },
    { concurrency: config.discoverConcurrency },
  )

  await queue.work('ingest.tick', async () => {
    const due = await ingest.dueSources()
    for (const sourceId of due)
      await queue.send(
        'ingest.discover',
        { sourceId, trigger: 'schedule' },
        { singletonKey: sourceId },
      )
    // Safety net: whatever waits in a stage is picked up even if its wake-up was lost.
    for (const stage of ['read', 'extract', 'resolve'] as const)
      await queue.send(`ingest.${stage}`, {}, { singletonKey: stage })
    log.debug({ sources: due.length }, 'ingest tick')
  })
  await queue.schedule('ingest.tick', config.tickCron, {})

  await queue.work('ingest.housekeeping', async () => {
    log.info(await ingest.purge(), 'ingest housekeeping')
  })
  await queue.schedule('ingest.housekeeping', '30 3 * * *', {})
}
