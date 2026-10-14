import { describe, expect, test } from 'bun:test'
import { memoWithTtl } from '../src/lib/memo.ts'

describe('memoWithTtl', () => {
  test('loads once per key within the ttl, then again', async () => {
    let clock = 0
    let loads = 0
    const memo = memoWithTtl(
      1000,
      async (k: string) => `${k}:${++loads}`,
      () => clock,
    )
    expect(await memo.get('a')).toBe('a:1')
    expect(await memo.get('a')).toBe('a:1')
    expect(await memo.get('b')).toBe('b:2')
    clock = 1000
    expect(await memo.get('a')).toBe('a:3')
  })

  test('concurrent callers share one load', async () => {
    let loads = 0
    const memo = memoWithTtl(1000, async () => {
      loads++
      await Promise.resolve()
      return loads
    })
    const [a, b] = await Promise.all([memo.get('x'), memo.get('x')])
    expect([a, b, loads]).toEqual([1, 1, 1])
  })

  test('a failed load is not cached', async () => {
    let calls = 0
    const memo = memoWithTtl(1000, async () => {
      if (++calls === 1) throw new Error('boom')
      return 'ok'
    })
    await expect(memo.get('x')).rejects.toThrow('boom')
    expect(await memo.get('x')).toBe('ok')
  })

  test('keeps a bounded number of keys, dropping the oldest', async () => {
    let loads = 0
    const memo = memoWithTtl(
      60_000,
      async (k: string) => `${k}:${++loads}`,
      () => 0,
      3,
    )
    for (const k of ['a', 'b', 'c', 'd']) await memo.get(k)
    expect(loads).toBe(4)
    await memo.get('d') // still cached
    await memo.get('b') // still cached
    expect(loads).toBe(4)
    expect(await memo.get('a')).toBe('a:5') // evicted: loaded again
  })
})
