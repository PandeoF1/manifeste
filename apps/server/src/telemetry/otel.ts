/**
 * OpenTelemetry bootstrap, shared by the API and the worker. Spans go to any OTLP endpoint
 * (Grafana Cloud in production) through the standard OTEL_EXPORTER_OTLP_* variables.
 * Without an endpoint nothing is exported and every span is a no-op.
 * The admin views do not depend on this: they read pipeline events from Postgres.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'

let sdk: NodeSDK | null = null

/**
 * Reads the environment itself: it runs as a preload (`bun --preload`), before `pg` is imported,
 * which the instrumentation needs to patch it. `pg` stays external in the build for the same reason.
 */
export function startTelemetry(env: Record<string, string | undefined> = process.env): boolean {
  if (sdk || !env.OTEL_EXPORTER_OTLP_ENDPOINT) return false
  const role = env.ROLE ?? 'all'
  sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? 'manifeste',
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    // HTTP spans come from the Elysia plugin, SQL spans from pg; fetch is not instrumented under Bun.
    instrumentations: [new PgInstrumentation()],
  })
  process.env.OTEL_RESOURCE_ATTRIBUTES = [
    process.env.OTEL_RESOURCE_ATTRIBUTES,
    `service.instance.role=${role}`,
    `deployment.environment=${env.NODE_ENV ?? 'development'}`,
  ]
    .filter(Boolean)
    .join(',')
  sdk.start()
  return true
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown()
  sdk = null
}
