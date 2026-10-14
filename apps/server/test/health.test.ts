import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDb } from '@manifeste/db'
import { testServerUrl } from '@manifeste/db/testing'
import { HealthService } from '../src/modules/health/service.ts'
import { MemoryBlobStore } from '../src/storage/blob-store.ts'
import { startTestServer, type TestServer } from './helpers.ts'

/** A store whose probe is whatever the test says. */
class ProbedStore extends MemoryBlobStore {
  calls: string[] = []
  behaviour: () => Promise<void> = async () => {}
  override async probe(mode: 'read' | 'write') {
    this.calls.push(mode)
    await this.behaviour()
  }
}

describe('readiness and the photo storage (HTTP)', () => {
  let s: TestServer
  const store = new ProbedStore()
  beforeAll(async () => {
    s = await startTestServer({}, { blobs: store })
  })
  afterAll(() => s.close())

  test('a storage that works: ready, nothing degraded, a latency', async () => {
    const res = await s.request('/api/health/ready')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      degraded: string[]
      checks: { photos: { ok: boolean; latencyMs?: number } }
    }
    expect(body.status).toBe('ready')
    expect(body.degraded).toEqual([])
    expect(body.checks.photos.ok).toBe(true)
    expect(body.checks.photos.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

describe('readiness with a storage that is down (HTTP)', () => {
  let s: TestServer
  beforeAll(async () => {
    const store = new ProbedStore()
    store.behaviour = async () => {
      throw new Error('The specified bucket does not exist')
    }
    s = await startTestServer({}, { blobs: store })
  })
  afterAll(() => s.close())

  test('still 200 and "ready" (the orchestrator must not pull the site), but degraded', async () => {
    const res = await s.request('/api/health/ready')
    // Coolify checks this address: a 503 here for a photo problem would take the whole site down.
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      degraded: string[]
      checks: { photos: { ok: boolean; detail?: string }; database: { ok: boolean } }
    }
    expect(body.status).toBe('ready')
    expect(body.degraded).toEqual(['photos'])
    expect(body.checks.photos).toEqual({ ok: false, detail: 'The specified bucket does not exist' })
    expect(body.checks.database.ok).toBe(true)
  })

  test('liveness never looks at the storage', async () => {
    const res = await s.request('/api/health/live')
    expect(res.status).toBe(200)
  })
})

describe('HealthService photo check', () => {
  const dbOnly = async () => createDb(testServerUrl())

  test('the answer is cached, so a monitor polling every few seconds does not hit the bucket', async () => {
    const store = new ProbedStore()
    const { db, close } = await dbOnly()
    try {
      const service = new HealthService(db, { isStarted: () => true } as never, 'api', 'v', store, {
        photosCacheMs: 60_000,
      })
      for (let i = 0; i < 5; i++) await service.ready()
      expect(store.calls).toEqual(['read']) // read-only, once
    } finally {
      await close()
    }
  })

  test('a storage that never answers is reported failing after the timeout, not waited for', async () => {
    const store = new ProbedStore()
    store.behaviour = () => new Promise<void>(() => {}) // hangs for ever
    const { db, close } = await dbOnly()
    try {
      const service = new HealthService(db, { isStarted: () => true } as never, 'api', 'v', store, {
        photosTimeoutMs: 100,
        photosCacheMs: 0,
      })
      const started = Date.now()
      const r = await service.ready()
      expect(Date.now() - started).toBeLessThan(2000)
      expect(r.checks.photos).toEqual({ ok: false, detail: 'no answer in 100 ms' })
      expect(r.degraded).toEqual(['photos'])
    } finally {
      await close()
    }
  })

  test('a failing storage does not change the status when the rest is fine', async () => {
    const store = new ProbedStore()
    store.behaviour = async () => {
      throw new Error('boom')
    }
    const { db, close } = await dbOnly()
    try {
      const service = new HealthService(db, { isStarted: () => true } as never, 'api', 'v', store, {
        photosCacheMs: 0,
      })
      const r = await service.ready()
      // Database and queue are fine; migrations of this scratch database are not, which is the
      // only reason for "not_ready" here. The photos never are one.
      expect(r.status === 'ready' || !r.checks.migrations.ok).toBe(true)
      expect(r.degraded).toEqual(['photos'])
    } finally {
      await close()
    }
  })
})
