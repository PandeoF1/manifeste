/**
 * OpenTelemetry bootstrap, shared by the API and the worker. Spans go to any OTLP endpoint
 * (Grafana Cloud in production) through the standard OTEL_EXPORTER_OTLP_* variables.
 * Without an endpoint nothing is exported and every span is a no-op.
 * The admin views do not depend on this: they read pipeline events from Postgres.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeSDK } from '@opentelemetry/sdk-node'
import type { Config } from '../config.ts'

let sdk: NodeSDK | null = null

export function startTelemetry(config: Config, role: string): boolean {
  if (sdk || !config.OTEL_EXPORTER_OTLP_ENDPOINT) return false
  sdk = new NodeSDK({
    serviceName: config.OTEL_SERVICE_NAME,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    // Auto-instrumentation relies on Node require hooks that Bun does not support:
    // HTTP spans come from the Elysia plugin, the rest are explicit spans.
    instrumentations: [],
  })
  process.env.OTEL_RESOURCE_ATTRIBUTES = [
    process.env.OTEL_RESOURCE_ATTRIBUTES,
    `service.instance.role=${role}`,
    `deployment.environment=${config.NODE_ENV}`,
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
