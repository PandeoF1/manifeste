/**
 * Spans for what OpenTelemetry cannot see by itself under Bun: outbound `fetch` (native, no
 * Node hooks), the blob store and the AI calls. `pg` is instrumented in otel.ts; everything else
 * the server does at the edge goes through one of these helpers. Without an exporter every span is
 * a no-op, so none of this costs anything when tracing is off.
 */
import { SpanKind, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api'
import type { Area, BlobInfo, BlobStore } from '../storage/blob-store.ts'

const tracer = trace.getTracer('manifeste')

/** Runs `fn` in a span; an error is recorded on it and rethrown. */
export function inSpan<T>(
  name: string,
  attributes: Attributes,
  fn: () => Promise<T>,
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes, kind }, async (span) => {
    try {
      return await fn()
    } catch (e) {
      span.recordException(e instanceof Error ? e : new Error(String(e)))
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: e instanceof Error ? e.message : String(e),
      })
      throw e
    } finally {
      span.end()
    }
  })
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * A client span per HTTP call: method, host, path (never the query: it can carry a token or a
 * search), status, size, and the redirect target. A status of 400 or more marks the span as an
 * error without throwing, so the caller keeps handling responses as before.
 */
export function tracedFetch<F extends FetchFn>(inner: F): F {
  const traced: FetchFn = (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const raw = input instanceof Request ? input.url : String(input)
    let url: URL | null = null
    try {
      url = new URL(raw)
    } catch {
      // a relative or malformed address: the span only carries the method
    }
    const host = url?.host ?? 'unknown'
    return tracer.startActiveSpan(
      `${method} ${host}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.request.method': method,
          'server.address': url?.hostname ?? '',
          'url.full': url ? `${url.origin}${url.pathname}` : '',
          'url.scheme': url?.protocol.replace(':', '') ?? '',
        },
      },
      async (span) => {
        try {
          const res = await inner(input, init)
          span.setAttribute('http.response.status_code', res.status)
          const size = res.headers.get('content-length')
          if (size) span.setAttribute('http.response.body.size', Number(size))
          const type = res.headers.get('content-type')
          if (type)
            span.setAttribute('http.response.header.content-type', type.split(';')[0] ?? type)
          const location = res.headers.get('location')
          if (location && res.status >= 300 && res.status < 400)
            span.setAttribute('http.response.header.location', location.split('?')[0] ?? location)
          if (res.status >= 400)
            span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.status}` })
          return res
        } catch (e) {
          span.recordException(e instanceof Error ? e : new Error(String(e)))
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: e instanceof Error ? e.message : String(e),
          })
          throw e
        } finally {
          span.end()
        }
      },
    )
  }
  return traced as F
}

/** The blob store (a volume or S3) with a span per operation: area and size, never the key. */
export class TracedBlobStore implements BlobStore {
  constructor(private readonly inner: BlobStore) {}

  private run<T>(op: string, attributes: Attributes, fn: () => Promise<T>) {
    return inSpan(`blob.${op}`, attributes, fn, SpanKind.CLIENT)
  }

  put(key: string, bytes: Uint8Array) {
    return this.run(
      'put',
      { 'blob.area': key.split('/')[0] ?? '', 'blob.size': bytes.length },
      () => this.inner.put(key, bytes),
    )
  }

  get(key: string) {
    return tracer.startActiveSpan(
      'blob.get',
      { kind: SpanKind.CLIENT, attributes: { 'blob.area': key.split('/')[0] ?? '' } },
      async (span) => {
        try {
          const bytes = await this.inner.get(key)
          span.setAttributes({ 'blob.found': bytes !== null, 'blob.size': bytes?.length ?? 0 })
          return bytes
        } catch (e) {
          span.recordException(e instanceof Error ? e : new Error(String(e)))
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw e
        } finally {
          span.end()
        }
      },
    )
  }

  delete(key: string) {
    return this.run('delete', { 'blob.area': key.split('/')[0] ?? '' }, () =>
      this.inner.delete(key),
    )
  }

  list(area: Area): Promise<BlobInfo[]> {
    return this.run('list', { 'blob.area': area }, () => this.inner.list(area))
  }

  probe(mode: 'read' | 'write') {
    return this.run('probe', { 'blob.probe.mode': mode }, () => this.inner.probe(mode))
  }
}
