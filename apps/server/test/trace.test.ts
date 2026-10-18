import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { context, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { MemoryBlobStore } from '../src/storage/blob-store.ts'
import { inSpan, TracedBlobStore, tracedFetch } from '../src/telemetry/trace.ts'

const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  trace.setGlobalTracerProvider(provider)
})
afterAll(() => provider.shutdown())

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
const stub =
  (fn: () => Promise<Response>): Fetch =>
  () =>
    fn()

const finished = () => exporter.getFinishedSpans()

describe('tracedFetch', () => {
  test('a client span with host, path without the query, status and size', async () => {
    exporter.reset()
    const fetchFn = tracedFetch(
      stub(
        async () =>
          new Response('ok', {
            status: 200,
            headers: { 'content-length': '2', 'content-type': 'text/html; charset=utf-8' },
          }),
      ),
    )
    await fetchFn('https://example.org/feed.xml?token=secret')
    const [span] = finished()
    expect(span?.name).toBe('GET example.org')
    expect(span?.attributes['url.full']).toBe('https://example.org/feed.xml')
    expect(JSON.stringify(span?.attributes)).not.toContain('secret')
    expect(span?.attributes['http.response.status_code']).toBe(200)
    expect(span?.attributes['http.response.body.size']).toBe(2)
    expect(span?.attributes['http.response.header.content-type']).toBe('text/html')
  })

  test('a 4xx or 5xx marks the span as an error and still returns the response', async () => {
    exporter.reset()
    const res = await tracedFetch(stub(async () => new Response('', { status: 503 })))(
      'https://example.org/',
      {
        method: 'post',
      },
    )
    expect(res.status).toBe(503)
    const [span] = finished()
    expect(span?.name).toBe('POST example.org')
    expect(span?.status.code).toBe(2)
  })

  test('a failed request records the exception and rethrows', async () => {
    exporter.reset()
    const failing = tracedFetch(
      stub(async () => {
        throw new Error('boom')
      }),
    )
    await expect(failing('https://example.org/')).rejects.toThrow('boom')
    const [span] = finished()
    expect(span?.events.some((e) => e.name === 'exception')).toBe(true)
  })

  test('the span is a child of the active one', async () => {
    exporter.reset()
    await inSpan('parent', {}, () =>
      tracedFetch(stub(async () => new Response('x')))('https://example.org/'),
    )
    const spans = finished()
    const parent = spans.find((s) => s.name === 'parent')
    const child = spans.find((s) => s.name === 'GET example.org')
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId)
  })
})

describe('TracedBlobStore', () => {
  test('one span per operation with area and size, never the key', async () => {
    exporter.reset()
    const store = new TracedBlobStore(new MemoryBlobStore())
    const key = `private/${crypto.randomUUID()}.jpg`
    await store.put(key, new Uint8Array(5))
    expect((await store.get(key))?.length).toBe(5)
    await store.get(`private/${crypto.randomUUID()}.jpg`)
    await store.delete(key)
    const spans = finished()
    expect(spans.map((s) => s.name)).toEqual(['blob.put', 'blob.get', 'blob.get', 'blob.delete'])
    expect(spans[0]?.attributes).toMatchObject({ 'blob.area': 'private', 'blob.size': 5 })
    expect(spans[2]?.attributes['blob.found']).toBe(false)
    expect(JSON.stringify(spans.map((s) => s.attributes))).not.toContain(key)
  })
})
