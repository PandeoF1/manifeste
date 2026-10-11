import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createMeter } from '@manifeste/ai'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
beforeAll(async () => {
  s = await startTestServer()
})
afterAll(() => s.close())

describe('AI configuration at boot', () => {
  test('without a key outside production, AI is off and says so', () => {
    expect(s.ctx.ai.config.enabled).toBe(false)
    expect(s.ctx.ai.judge()).toBeNull()
  })

  test('in production a worker without a key refuses to start; the api does not need one', async () => {
    const boot = (env: Record<string, string>) =>
      startTestServer({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'x', ...env })
    await expect(boot({ ROLE: 'worker' })).rejects.toThrow(/GEMINI_API_KEY/)
    const api = await boot({ ROLE: 'api' })
    await api.close()
  })

  test('with a key, the defaults are the production models', async () => {
    const withKey = await startTestServer({ GEMINI_API_KEY: 'k', JEV_API_KEY: 'j' })
    try {
      expect(withKey.ctx.ai.config.enabled).toBe(true)
      expect(withKey.ctx.ai.config.tasks.extract.models[0]?.model).toBe('gemini-3.5-flash-lite')
      expect(withKey.ctx.ai.judge()?.provider).toBe('jev')
    } finally {
      await withKey.close()
    }
  })
})

describe('AI usage persistence', () => {
  test('flush upserts hourly buckets and adds up on the same bucket', async () => {
    const meter = createMeter()
    const call = (calls: number, cost: number) => {
      for (let i = 0; i < calls; i++)
        meter.record({
          task: 'extract',
          provider: 'gemini',
          model: 'gemini-3.5-flash-lite',
          promptVersion: 'v1',
          usage: { calls: 1, promptTokens: 1000, outputTokens: 100, thoughtsTokens: 0 },
          latencyMs: 200,
          outcome: 'ok',
          costUsd: cost,
        })
    }
    const { AiUsageService } = await import('../src/modules/ai/service.ts')
    const service = new AiUsageService(
      s.ctx.db,
      () => meter.spentUsd,
      () => meter.drain(),
    )
    call(2, 0.01)
    expect(await service.spentToday()).toBeCloseTo(0.02) // unflushed counts already
    await service.flush()
    call(1, 0.01)
    await service.flush()
    expect(await service.spentToday()).toBeCloseTo(0.03) // flushed once, not twice
    const [row] = await service.usage(1)
    expect(row).toMatchObject({
      task: 'extract',
      model: 'gemini-3.5-flash-lite',
      calls: 3,
      failures: 0,
      promptTokens: 3000,
      outputTokens: 300,
      avgLatencyMs: 200,
    })
    expect(row?.costUsd).toBeCloseTo(0.03)
  })
})

describe('/api/staff/ai', () => {
  test('requires an admin session', async () => {
    expect((await s.request('/api/staff/ai/status')).status).toBe(401)
    const cookie = await signInStaff(s, 'mod@example.org', 'moderator')
    const res = await s.request('/api/staff/ai/status', { headers: { cookie } })
    expect(res.status).toBe(403)
  })

  test('admin sees switches, models and spend', async () => {
    const cookie = await signInStaff(s, 'admin@example.org', 'admin')
    const headers = { cookie }
    const status = await s.request('/api/staff/ai/status', { headers })
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({
      enabled: false,
      extractPrompt: 'v1',
      judge: 'off',
      dailyBudgetUsd: 0,
    })
    const usage = await s.request('/api/staff/ai/usage?days=7', { headers })
    expect(usage.status).toBe(200)
    expect(Array.isArray(await usage.json())).toBe(true)
  })
})
