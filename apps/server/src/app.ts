/**
 * The HTTP application: every module mounted on one Elysia instance.
 * `App` is the type the web client imports for Eden Treaty.
 */
import { opentelemetry } from '@elysiajs/opentelemetry'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import type { AppContext } from './context.ts'
import { authRoutes } from './auth/plugin.ts'
import { healthModule } from './modules/health/index.ts'
import { HealthService } from './modules/health/service.ts'
import { analyticsModule } from './modules/analytics/index.ts'
import { AnalyticsService } from './modules/analytics/service.ts'
import { openDataModule } from './modules/open-data/index.ts'
import { OpenDataService } from './modules/open-data/service.ts'
import { shareModule, sharePage } from './modules/share/index.ts'
import { ShareService } from './modules/share/service.ts'
import { reportsModule } from './modules/reports/index.ts'
import { ReportsService } from './modules/reports/service.ts'
import { schoolsModule } from './modules/schools/index.ts'
import { SchoolsService } from './modules/schools/service.ts'
import { settingsModule } from './modules/settings/index.ts'
import { SettingsService } from './modules/settings/service.ts'
import { statusesModule } from './modules/statuses/index.ts'
import { StatusesService } from './modules/statuses/service.ts'
import { timelineModule } from './modules/timeline/index.ts'
import { TimelineService } from './modules/timeline/service.ts'
import { aiModule } from './modules/ai/index.ts'
import { moderationModule } from './modules/moderation/index.ts'
import { ModerationService } from './modules/moderation/service.ts'
import { pipelineModule } from './modules/pipeline/index.ts'
import { PipelineService } from './modules/pipeline/service.ts'
import { sourcesModule } from './modules/sources/index.ts'
import { SourcesService } from './modules/sources/service.ts'
import { IngestService } from './ingest/service.ts'
import { staffModule } from './modules/staff/index.ts'
import { StaffService } from './modules/staff/service.ts'
import { realtimeModule } from './realtime/ws.ts'
import { requestLog } from './plugins/request-log.ts'
import { apiDocs } from './web/docs.ts'
import { spa } from './web/spa.ts'

export function createApp(ctx: AppContext) {
  const { config, db, auth, queue, log, version } = ctx
  const settings = new SettingsService(db)
  const statuses = new StatusesService(db, settings)
  const analytics = new AnalyticsService(db)
  const schools = new SchoolsService(db)
  const openData = new OpenDataService(db, settings, statuses)
  const share = new ShareService(statuses, schools, openData)
  const webDist = config.WEB_DIST
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
    .use(openDataModule(openData))
    .use(schoolsModule(schools))
    .use(analyticsModule(analytics))
    .use(
      reportsModule(
        new ReportsService(
          db,
          ctx.blobs,
          analytics,
          { secret: config.TURNSTILE_SECRET_KEY, production: config.NODE_ENV === 'production' },
          log,
        ),
        ctx.blobs,
      ),
    )
    .use(realtimeModule(ctx.bus, auth))
    .use(timelineModule(new TimelineService(db, settings)))
    .use(
      shareModule(share, config.PUBLIC_URL, {
        fontsDir: join(webDist || '.', 'fonts'),
        wasmPath: config.RESVG_WASM,
      }),
    )
    .use(staffModule(auth, new StaffService(db, auth, config.PUBLIC_URL)))
    .use(aiModule(auth, ctx.ai, ctx.aiUsage))
    .use(moderationModule(auth, new ModerationService(db, ctx.blobs, ctx.bus, settings)))
    .use(sourcesModule(auth, new SourcesService(db, queue)))
    .use(pipelineModule(auth, new PipelineService(db, queue, new IngestService(ctx))))

  return webDist
    ? app.use(spa(webDist, (request) => sharePage(request, share, config.PUBLIC_URL, webDist)))
    : app
}

export type App = ReturnType<typeof createApp>
