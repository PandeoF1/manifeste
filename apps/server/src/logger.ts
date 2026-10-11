import { trace } from '@opentelemetry/api'
import pino, { type Logger } from 'pino'

export type { Logger }

/** JSON logs on stdout, with the active trace and span ids so logs and traces link up. */
export function createLogger(level: string, base: Record<string, unknown> = {}): Logger {
  return pino({
    level,
    base,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin() {
      const span = trace.getActiveSpan()?.spanContext()
      return span ? { trace_id: span.traceId, span_id: span.spanId } : {}
    },
  })
}
