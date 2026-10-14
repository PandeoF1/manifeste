import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestDb, type TestDb } from '@manifeste/db/testing'
import { createLogger } from '../src/logger.ts'
import { PgBossQueue } from '../src/queue/queue.ts'

let testDb: TestDb
let queue: PgBossQueue
beforeAll(async () => {
  testDb = await createTestDb()
  queue = new PgBossQueue(testDb.url, createLogger('silent'), { max: 2 })
  await queue.start()
})
afterAll(async () => {
  await queue.stop()
  await testDb.drop()
})

describe('PgBossQueue', () => {
  test('runs a job sent to a defined queue', async () => {
    await queue.define('system.heartbeat', { retryLimit: 0, policy: 'exclusive' })
    const seen = new Promise<string>((resolve) => {
      void queue.work(
        'system.heartbeat',
        async (jobs) => {
          for (const job of jobs) resolve(job.id)
        },
        { pollingIntervalSeconds: 0.5 },
      )
    })
    const id = await queue.send('system.heartbeat', {})
    expect(id).not.toBeNull()
    expect(await seen).toBe(id as string)
  })

  test('a singleton key prevents duplicate jobs', async () => {
    const first = await queue.send(
      'system.heartbeat',
      {},
      { singletonKey: 'same', startAfterSeconds: 60 },
    )
    const second = await queue.send(
      'system.heartbeat',
      {},
      { singletonKey: 'same', startAfterSeconds: 60 },
    )
    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  test('reports per-queue stats', async () => {
    const stats = await queue.stats()
    expect(stats.find((s) => s.name === 'system.heartbeat')).toBeDefined()
  })
})
