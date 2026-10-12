import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectImageKind, hasMetadata } from '../src/lib/image.ts'
import { S3BlobStore } from '../src/storage/s3-blob-store.ts'
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

/**
 * A real S3 API: MinIO in CI, moto or MinIO locally. Set TEST_S3_ENDPOINT (and, if they differ,
 * TEST_S3_BUCKET / TEST_S3_KEY / TEST_S3_SECRET); the bucket must exist. Each store gets its own
 * prefix, so tests do not see each other's objects.
 */
const s3Endpoint = process.env.TEST_S3_ENDPOINT
const s3Store = (prefix = `t-${crypto.randomUUID()}`) =>
  new S3BlobStore({
    bucket: process.env.TEST_S3_BUCKET ?? 'manifeste-test',
    accessKeyId: process.env.TEST_S3_KEY ?? 'test',
    secretAccessKey: process.env.TEST_S3_SECRET ?? 'test',
    endpoint: s3Endpoint ?? '',
    region: 'us-east-1',
    prefix,
  })

const stores: Array<[string, () => BlobStore]> = [
  ['filesystem', () => new FsBlobStore(join(dir, crypto.randomUUID()))],
  ['memory', () => new MemoryBlobStore()],
  ...(s3Endpoint ? [['s3', () => s3Store()] as [string, () => BlobStore]] : []),
]

describe.each<[string, () => BlobStore]>(stores)('%s blob store', (_name, make) => {
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

describe.skipIf(!s3Endpoint)('s3 blob store', () => {
  test('keeps what it stores byte for byte, with the right content type', async () => {
    const store = s3Store()
    const bytes = new Uint8Array(Array.from({ length: 5000 }, (_, i) => i % 256))
    const key = newBlobKey('public', 'webp')
    await store.put(key, bytes)
    expect(await store.get(key)).toEqual(bytes)
  })

  test('a missing object is null, not an error', async () => {
    expect(await s3Store().get(newBlobKey('public', 'jpeg'))).toBeNull()
  })

  test('two prefixes in one bucket do not see each other (staging next to production)', async () => {
    const a = s3Store(`a-${crypto.randomUUID()}`)
    const b = s3Store(`b-${crypto.randomUUID()}`)
    const key = newBlobKey('private', 'jpeg')
    await a.put(key, new Uint8Array([1]))
    expect(await b.get(key)).toBeNull()
    expect((await b.list('private')).length).toBe(0)
    expect((await a.list('private')).map((i) => i.key)).toEqual([key])
  })

  test('listing goes past one page of 1000 and reports real modification times', async () => {
    const store = s3Store()
    const keys = Array.from({ length: 1010 }, () => newBlobKey('private', 'jpeg'))
    for (let i = 0; i < keys.length; i += 50)
      await Promise.all(keys.slice(i, i + 50).map((k) => store.put(k, new Uint8Array([1]))))
    const listed = await store.list('private')
    expect(listed).toHaveLength(1010)
    expect(new Set(listed.map((l) => l.key))).toEqual(new Set(keys))
    // Just written: the sweeper must not take them for old blobs.
    const age = Date.now() - Math.min(...listed.map((l) => l.modifiedAt.getTime()))
    expect(age).toBeLessThan(5 * 60_000)
    expect(age).toBeGreaterThanOrEqual(-60_000)
  }, 60_000)

  test('objects that are not ours are ignored by the listing', async () => {
    const prefix = `x-${crypto.randomUUID()}`
    const store = s3Store(prefix)
    const key = newBlobKey('private', 'jpeg')
    await store.put(key, new Uint8Array([1]))
    // Something else in the same place (a console upload, a lifecycle marker…).
    const raw = new Bun.S3Client({
      bucket: process.env.TEST_S3_BUCKET ?? 'manifeste-test',
      accessKeyId: process.env.TEST_S3_KEY ?? 'test',
      secretAccessKey: process.env.TEST_S3_SECRET ?? 'test',
      endpoint: s3Endpoint ?? '',
      region: 'us-east-1',
    })
    await raw.write(`${prefix}/private/readme.txt`, 'hello')
    expect((await store.list('private')).map((i) => i.key)).toEqual([key])
  })
})
