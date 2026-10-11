import { describe, expect, test } from 'bun:test'
import { createChain, createMeter } from '../src/index.ts'
import { at, fail, noSleep, request, scripted } from './helpers.ts'

const chain = (models: ReturnType<typeof scripted>[], extra = {}) =>
  createChain({ task: 'extract', promptVersion: 'v1', models, sleep: noSleep, ...extra })

describe('model chain', () => {
  test('first model answers', async () => {
    const a = scripted('a', { ok: 1 })
    const result = await chain([a]).generate(request)
    expect(result.model).toBe('a')
  })

  test('temporary error: retried on the same model, then the next one', async () => {
    const a = scripted('a', fail('unavailable', 503))
    const b = scripted('b', { ok: 1 })
    const c = chain([a, b])
    expect((await c.generate(request)).model).toBe('b')
    expect(a.calls).toBe(2) // one retry
  })

  test('a temporary error that clears on retry stays on the model', async () => {
    const a = scripted('a', fail('network'), { ok: 1 })
    const c = chain([a, scripted('b', { ok: 2 })])
    expect((await c.generate(request)).model).toBe('a')
  })

  test('quota and closed model: next model at once, no retry', async () => {
    for (const kind of ['rate-limit', 'not-found'] as const) {
      const a = scripted('a', fail(kind))
      const b = scripted('b', { ok: 1 })
      expect((await chain([a, b]).generate(request)).model).toBe('b')
      expect(a.calls).toBe(1)
    }
  })

  test('billing, auth and refused requests stop everything', async () => {
    for (const kind of ['billing', 'auth', 'bad-request'] as const) {
      const a = scripted('a', fail(kind))
      const b = scripted('b', { ok: 1 })
      const error = await chain([a, b])
        .generate(request)
        .catch((e) => e)
      expect(error.kind).toBe(kind)
      expect(b.calls).toBe(0)
    }
  })

  test('an answer that is not JSON moves to the next model', async () => {
    const a = scripted('a', null)
    const b = scripted('b', { ok: 1 })
    expect((await chain([a, b]).generate(request)).model).toBe('b')
    expect(a.calls).toBe(1)
  })

  test('nothing answers: an unavailable error that lists the failures', async () => {
    const error = await chain([
      scripted('a', fail('rate-limit')),
      scripted('b', fail('unavailable')),
    ])
      .generate(request)
      .catch((e) => e)
    expect(error.kind).toBe('unavailable')
    expect(error.message).toContain('a: rate-limit')
    expect(error.message).toContain('b: unavailable')
  })

  test('sticky: after a model answers, the next calls start with it', async () => {
    const a = scripted('a', fail('rate-limit'))
    const b = scripted('b', { ok: 1 })
    const c = chain([a, b])
    await c.generate(request)
    await c.generate(request)
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(2)
    expect([...c.served]).toEqual(['b'])
    expect(c.calls).toBe(2)
    expect(c.usage.b?.calls).toBe(2)
  })

  test('the guard can refuse a call (kill switch, budget)', async () => {
    const a = scripted('a', { ok: 1 })
    const guard = {
      check: () => {
        throw fail('budget')
      },
    }
    const error = await chain([a], { guard })
      .generate(request)
      .catch((e) => e)
    expect(error.kind).toBe('budget')
    expect(a.calls).toBe(0)
  })

  test('every call, failed ones too, goes to the sink with its cost', async () => {
    const meter = createMeter()
    const a = scripted('gemini-3.5-flash-lite', fail('rate-limit'))
    const b = scripted('gemini-3.5-flash', { ok: 1 })
    await chain([a, b], {
      sink: meter,
      prices: { 'gemini-3.5-flash': { inputPerMTok: 1000, outputPerMTok: 0 } },
    }).generate(request)
    const rows = meter.drain()
    expect(rows.map((r) => [r.model, r.calls, r.failures])).toEqual([
      ['gemini-3.5-flash-lite', 1, 1],
      ['gemini-3.5-flash', 1, 0],
    ])
    expect(at(rows, 1).costUsd).toBeCloseTo(0.01) // 10 prompt tokens at 1000 USD per million
    expect(meter.drain()).toEqual([])
  })
})
