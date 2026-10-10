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
import { openDataModule } from './modules/open-data/index.ts'
import { OpenDataService } from './modules/open-data/service.ts'
import { schoolsModule } from './modules/schools/index.ts'
import { SchoolsService } from './modules/schools/service.ts'
import { settingsModule } from './modules/settings/index.ts'
import { SettingsService } from './modules/settings/service.ts'
import { statusesModule } from './modules/statuses/index.ts'
import { StatusesService } from './modules/statuses/service.ts'
import { timelineModule } from './modules/timeline/index.ts'
import { TimelineService } from './modules/timeline/service.ts'
import { staffModule } from './modules/staff/index.ts'
import { StaffService } from './modules/staff/service.ts'
import { requestLog } from './plugins/request-log.ts'
import { apiDocs } from './web/docs.ts'
import { spa } from './web/spa.ts'

export function createApp(ctx: AppContext) {
  const { config, db, auth, queue, log, version } = ctx
  const settings = new SettingsService(db)
  const statuses = new StatusesService(db, settings)
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
    .onError({ as: 'global' }, ({ code, error, path }) => {
      if (code === 'VALIDATION' || code === 'NOT_FOUND' || code === 'PARSE') return
      log.error({ err: error, path }, 'unhandled error')
    })
    .use(apiDocs(version))
    .use(authRoutes(auth))
    .use(healthModule(new HealthService(db, queue, config.ROLE, version)))
    .use(settingsModule(settings))
    .use(statusesModule(statuses))
    .use(openDataModule(new OpenDataService(db, settings, statuses)))
    .use(schoolsModule(new SchoolsService(db)))
    .use(timelineModule(new TimelineService(db, settings)))
    .use(staffModule(auth, new StaffService(db, auth, config.PUBLIC_URL)))

  return config.WEB_DIST ? app.use(spa(config.WEB_DIST)) : app
}

export type App = ReturnType<typeof createApp>
