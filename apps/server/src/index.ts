/** Process entrypoint. ROLE decides what runs: the HTTP API, the job worker, or both. */
import { runMigrations } from '@manifeste/db'
import { createApp } from './app.ts'
import { ConfigError, loadConfig } from './config.ts'
import { createContext } from './context.ts'
import { defineIngestQueues } from './ingest/jobs.ts'
import { resolvePreviewEnv } from './preview.ts'
import { startTelemetry, stopTelemetry } from './telemetry/otel.ts'
import { startWorker } from './worker.ts'

let config
try {
  config = loadConfig(await resolvePreviewEnv(process.env))
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

startTelemetry(config, config.ROLE)
const ctx = createContext(config)
const { log } = ctx

if (config.MIGRATE_ON_BOOT) {
  await runMigrations(ctx.db)
  log.info('migrations applied')
}

await ctx.queue.start()
// Any process may send a job (the API's "read this source now"): the queues must exist.
await defineIngestQueues(ctx.queue)
// Only API instances hold WebSocket clients, so only they listen for events.
if (config.ROLE !== 'worker') await ctx.bus.start()

const server =
  config.ROLE === 'worker'
    ? null
    : createApp(ctx).listen({
        port: config.PORT,
        hostname: '0.0.0.0',
        // A report is a form and a 5 MB photo at most.
        maxRequestBodySize: 8 * 1024 * 1024,
      })
if (server) log.info({ port: config.PORT, version: ctx.version }, 'api listening')

if (config.ROLE !== 'api') await startWorker(ctx)

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'shutting down')
  await server?.stop()
  await ctx.close()
  await stopTelemetry()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
