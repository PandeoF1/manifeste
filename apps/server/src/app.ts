/**
 * The HTTP application: every module mounted on one Elysia instance.
 * `App` is the type the web client imports for Eden Treaty.
 */
import { opentelemetry } from '@elysiajs/opentelemetry'
import { Elysia } from 'elysia'
import type { AppContext } from './context.ts'
import { authRoutes } from './auth/plugin.ts'
import { healthModule } from './modules/health/index.ts'
import { HealthService } from './modules/health/service.ts'
import { staffModule } from './modules/staff/index.ts'
import { StaffService } from './modules/staff/service.ts'
import { requestLog } from './plugins/request-log.ts'
import { apiDocs } from './web/docs.ts'
import { spa } from './web/spa.ts'

export function createApp(ctx: AppContext) {
  const { config, db, auth, queue, log, version } = ctx
  // HTTP spans only when an exporter is configured (startTelemetry registered the provider).
  const tracing = config.OTEL_EXPORTER_OTLP_ENDPOINT
    ? opentelemetry({
        serviceName: config.OTEL_SERVICE_NAME,
        checkIfShouldTrace: (req) => !new URL(req.url).pathname.startsWith('/api/health'),
      })
    : new Elysia({ name: 'tracing.off' })
  const app = new Elysia()
    .use(tracing)
    .use(requestLog(log))
    .onError({ as: 'global' }, ({ code, error, request }) => {
      if (code === 'VALIDATION' || code === 'NOT_FOUND' || code === 'PARSE') return
      log.error({ err: error, path: new URL(request.url).pathname }, 'unhandled error')
    })
    .use(apiDocs(version))
    .use(authRoutes(auth))
    .use(healthModule(new HealthService(db, queue, config.ROLE, version)))
    .use(staffModule(auth, new StaffService(db, auth, config.PUBLIC_URL)))

  return config.WEB_DIST ? app.use(spa(config.WEB_DIST)) : app
}

export type App = ReturnType<typeof createApp>
