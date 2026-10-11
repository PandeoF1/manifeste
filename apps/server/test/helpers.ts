import { createTestDb, type TestDb } from '@manifeste/db/testing'
import { eq } from 'drizzle-orm'
import { schema } from '@manifeste/db'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createContext, type AppContext } from '../src/context.ts'
import { defineIngestQueues } from '../src/ingest/jobs.ts'
import { createLogger } from '../src/logger.ts'
import { StaffService } from '../src/modules/staff/service.ts'
import { MemoryBlobStore } from '../src/storage/blob-store.ts'

export const TEST_ORIGIN = 'http://localhost:3000'

export interface TestServer {
  testDb: TestDb
  ctx: AppContext
  blobs: MemoryBlobStore
  app: ReturnType<typeof createApp>
  /** Sends a request to the app in-process, with a same-origin Origin header. */
  request(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>
  /** Starts a real HTTP server on a free port (WebSockets need one). */
  listen(): { url: string; wsUrl: string; stop(): Promise<void> }
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
  await defineIngestQueues(ctx.queue)
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
    listen() {
      const server = app.listen({ port: 0, hostname: '127.0.0.1' })
      const port = server.server?.port
      return {
        url: `http://127.0.0.1:${port}`,
        wsUrl: `ws://127.0.0.1:${port}`,
        stop: async () => void (await server.stop(true)),
      }
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

const STAFF_PASSWORD = 'correct horse battery staple'

/**
 * Creates a staff account the way the product does (an invite and a one-time password link),
 * signs it in and returns the session cookie. Admins get TOTP marked as enabled, since the
 * `staff` rule refuses them otherwise.
 */
export async function signInStaff(
  s: TestServer,
  email: string,
  role: 'admin' | 'moderator',
  options: { twoFactor?: boolean } = {},
): Promise<string> {
  const service = new StaffService(s.ctx.db, s.ctx.auth, s.ctx.config.PUBLIC_URL)
  const invitation = await service.invite({ email, name: role, role })
  if (!('passwordLink' in invitation)) throw new Error('invite failed')
  const token = new URL(invitation.passwordLink).pathname.split('/').at(-1)
  const reset = await s.request('/api/auth/reset-password', {
    method: 'POST',
    json: { token, newPassword: STAFF_PASSWORD },
  })
  if (reset.status !== 200) throw new Error(`password reset failed: ${reset.status}`)
  const signIn = await s.request('/api/auth/sign-in/email', {
    method: 'POST',
    json: { email, password: STAFF_PASSWORD },
  })
  if (signIn.status !== 200) throw new Error(`sign-in failed: ${signIn.status}`)
  if (options.twoFactor ?? role === 'admin') {
    await s.ctx.db
      .update(schema.user)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.user.email, email))
  }
  return cookieFrom(signIn)
}
