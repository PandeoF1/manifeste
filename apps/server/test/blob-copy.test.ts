import { describe, expect, test } from 'bun:test'
import { MemoryBlobStore, newBlobKey } from '../src/storage/blob-store.ts'
import { copyBlobs } from '../src/storage/copy.ts'

const fill = async (store: MemoryBlobStore) => {
  const keys = {
    pub1: newBlobKey('public', 'jpeg'),
    pub2: newBlobKey('public', 'webp'),
    priv: newBlobKey('private', 'jpeg'),
  }
  await store.put(keys.pub1, new Uint8Array([1, 2, 3]))
  await store.put(keys.pub2, new Uint8Array([4, 5]))
  await store.put(keys.priv, new Uint8Array([9]))
  return keys
}

describe('copyBlobs', () => {
  test('copies every area, byte for byte', async () => {
    const from = new MemoryBlobStore()
    const to = new MemoryBlobStore()
    const keys = await fill(from)
    const results = await copyBlobs(from, to)
    expect(results.map((r) => [r.area, r.found, r.copied])).toEqual([
      ['private', 1, 1],
      ['public', 2, 2],
    ])
    expect([...((await to.get(keys.pub1)) ?? [])]).toEqual([1, 2, 3])
    expect(results.find((r) => r.area === 'public')?.bytes).toBe(5)
  })

  test('can be limited to the published photos', async () => {
    const from = new MemoryBlobStore()
    const to = new MemoryBlobStore()
    await fill(from)
    await copyBlobs(from, to, { areas: ['public'] })
    expect(await to.list('private')).toHaveLength(0)
    expect(await to.list('public')).toHaveLength(2)
  })

  test('is safe to repeat: what is already there is skipped, not rewritten', async () => {
    const from = new MemoryBlobStore()
    const to = new MemoryBlobStore()
    const keys = await fill(from)
    await copyBlobs(from, to)
    await to.put(keys.pub1, new Uint8Array([7])) // edited on the target: left alone
    const again = await copyBlobs(from, to)
    expect(again.every((r) => r.copied === 0)).toBe(true)
    expect(again.find((r) => r.area === 'public')?.alreadyThere).toBe(2)
    expect([...((await to.get(keys.pub1)) ?? [])]).toEqual([7])
  })

  test('a dry run reads and counts, and writes nothing', async () => {
    const from = new MemoryBlobStore()
    const to = new MemoryBlobStore()
    await fill(from)
    const results = await copyBlobs(from, to, { dryRun: true })
    expect(results.reduce((n, r) => n + r.copied, 0)).toBe(3)
    expect((await to.list('public')).length + (await to.list('private')).length).toBe(0)
  })

  test('one failing photo is reported, the others still go', async () => {
    const from = new MemoryBlobStore()
    const keys = await fill(from)
    const to = new MemoryBlobStore()
    const put = to.put.bind(to)
    to.put = async (key, bytes) => {
      if (key === keys.pub1) throw new Error('quota exceeded')
      return put(key, bytes)
    }
    const results = await copyBlobs(from, to)
    const pub = results.find((r) => r.area === 'public')
    expect(pub?.failed).toEqual([{ key: keys.pub1, error: 'quota exceeded' }])
    expect(pub?.copied).toBe(1)
  })
})
