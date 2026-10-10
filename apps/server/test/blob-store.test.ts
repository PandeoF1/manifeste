import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectImageKind, hasMetadata } from '../src/lib/image.ts'
import {
  FsBlobStore,
  MemoryBlobStore,
  contentTypeOf,
  isBlobKey,
  newBlobKey,
  type BlobStore,
} from '../src/storage/blob-store.ts'

const jpeg = (...segments: number[][]) =>
  new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x02])
const app = (marker: number, size = 6) => [0xff, marker, 0x00, size, ...new Array(size - 2).fill(0)]

describe('image checks', () => {
  test('detects JPEG and WebP, nothing else', () => {
    expect(detectImageKind(jpeg())).toBe('jpeg')
    const webp = new Uint8Array(
      [...'RIFF']
        .map((c) => c.charCodeAt(0))
        .concat(
          [0, 0, 0, 0],
          [...'WEBP'].map((c) => c.charCodeAt(0)),
        ),
    )
    expect(detectImageKind(webp)).toBe('webp')
    expect(detectImageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(detectImageKind(new Uint8Array())).toBeNull()
  })

  test('refuses JPEGs with EXIF/XMP (APP1), IPTC (APP13) or comments', () => {
    expect(hasMetadata(jpeg())).toBe(false)
    expect(hasMetadata(jpeg(app(0xe0)))).toBe(false) // JFIF is fine
    expect(hasMetadata(jpeg(app(0xe1)))).toBe(true)
    expect(hasMetadata(jpeg(app(0xed)))).toBe(true)
    expect(hasMetadata(jpeg(app(0xfe)))).toBe(true)
  })

  test('refuses WebP with EXIF or XMP chunks', () => {
    const chunk = (id: string, size = 2) =>
      [...id].map((c) => c.charCodeAt(0)).concat([size, 0, 0, 0], new Array(size).fill(0))
    const webp = (...chunks: number[][]) =>
      new Uint8Array(
        [...'RIFF']
          .map((c) => c.charCodeAt(0))
          .concat(
            [0, 0, 0, 0],
            [...'WEBP'].map((c) => c.charCodeAt(0)),
            ...chunks,
          ),
      )
    expect(hasMetadata(webp(chunk('VP8 ')))).toBe(false)
    expect(hasMetadata(webp(chunk('VP8 '), chunk('EXIF')))).toBe(true)
    expect(hasMetadata(webp(chunk('XMP ')))).toBe(true)
  })
})

describe('blob keys', () => {
  test('only random names with known extensions in a known area', () => {
    expect(isBlobKey(newBlobKey('private', 'jpeg'))).toBe(true)
    expect(isBlobKey(newBlobKey('public', 'webp'))).toBe(true)
    for (const bad of [
      '../etc/passwd',
      'private/../../x.jpg',
      'private/abc.jpg',
      'other/00000000-0000-0000-0000-000000000000.jpg',
      'private/00000000-0000-0000-0000-000000000000.png',
    ])
      expect(isBlobKey(bad)).toBe(false)
    expect(contentTypeOf('public/x.webp')).toBe('image/webp')
    expect(contentTypeOf('public/x.jpg')).toBe('image/jpeg')
  })
})

const dir = mkdtempSync(join(tmpdir(), 'manifeste-blobs-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe.each<[string, () => BlobStore]>([
  ['filesystem', () => new FsBlobStore(join(dir, crypto.randomUUID()))],
  ['memory', () => new MemoryBlobStore()],
])('%s blob store', (_name, make) => {
  test('put, get, list and delete', async () => {
    const store = make()
    const a = newBlobKey('private', 'jpeg')
    const b = newBlobKey('public', 'jpeg')
    await store.put(a, new Uint8Array([1, 2, 3]))
    await store.put(b, new Uint8Array([4]))
    expect([...((await store.get(a)) ?? [])]).toEqual([1, 2, 3])
    expect((await store.list('private')).map((i) => i.key)).toEqual([a])
    expect((await store.list('public')).map((i) => i.key)).toEqual([b])
    await store.delete(a)
    expect(await store.get(a)).toBeNull()
    await store.delete(a) // deleting twice is fine
  })

  test('refuses keys that are not ours', async () => {
    const store = make()
    await expect(store.put('private/../escape.jpg', new Uint8Array([1]))).rejects.toThrow()
    await expect(store.get('nope')).rejects.toThrow()
  })
})

test('the filesystem store reports modification times (used by the sweeper)', async () => {
  const root = join(dir, 'times')
  const store = new FsBlobStore(root)
  const key = newBlobKey('private', 'jpeg')
  await store.put(key, new Uint8Array([1]))
  const old = new Date(Date.now() - 3 * 86_400_000)
  utimesSync(join(root, key), old, old)
  const [info] = await store.list('private')
  expect(info?.modifiedAt.getTime()).toBeLessThan(Date.now() - 2 * 86_400_000)
})
