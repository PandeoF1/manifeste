import { createTestDb, type TestDb } from '@manifeste/db/testing'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createContext, type AppContext } from '../src/context.ts'
import { createLogger } from '../src/logger.ts'
import { MemoryBlobStore } from '../src/storage/blob-store.ts'

export const TEST_ORIGIN = 'http://localhost:3000'

export interface TestServer {
  testDb: TestDb
  ctx: AppContext
  blobs: MemoryBlobStore
  app: ReturnType<typeof createApp>
  /** Sends a request to the app in-process, with a same-origin Origin header. */
  request(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>
  close(): Promise<void>
}

export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const testDb = await createTestDb()
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: testDb.url,
    AUTH_SECRET: 'test-secret-test-secret-test-secret-00',
    PUBLIC_URL: TEST_ORIGIN,
    WEB_DIST: '',
    LOG_LEVEL: 'silent',
    ...env,
  })
  const blobs = new MemoryBlobStore()
  const ctx = createContext(config, { dbHandle: testDb, log: createLogger('silent'), blobs })
  await ctx.queue.start()
  const app = createApp(ctx)
  return {
    testDb,
    ctx,
    blobs,
    app,
    request(path, init = {}) {
      const headers = new Headers(init.headers)
      headers.set('origin', TEST_ORIGIN)
      let body = init.body
      if (init.json !== undefined) {
        headers.set('content-type', 'application/json')
        body = JSON.stringify(init.json)
      }
      return app.handle(new Request(`${TEST_ORIGIN}${path}`, { ...init, headers, body }))
    },
    async close() {
      await ctx.queue.stop()
      await testDb.drop()
    },
  }
}

/** The Cookie header to send back, from a response's Set-Cookie headers. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}
