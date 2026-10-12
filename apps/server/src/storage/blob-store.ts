/**
 * Where photos live. A port with a filesystem adapter (a local volume), an S3-compatible one
 * (Cloudflare R2, MinIO: see s3-blob-store.ts) and an in-memory one for tests.
 * `create-blob-store.ts` picks the adapter from the configuration.
 *
 * Keys are `<area>/<uuid>.<ext>`: `private/` holds the originals awaiting moderation, `public/`
 * the blurred versions staff chose to publish.
 */
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

export const AREAS = ['private', 'public'] as const
export type Area = (typeof AREAS)[number]

/** The only key shape accepted: random names, known extensions, no path tricks. */
export const BLOB_KEY =
  /^(private|public)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$/

export const isBlobKey = (key: string): boolean => BLOB_KEY.test(key)

export const newBlobKey = (area: Area, kind: 'jpeg' | 'webp'): string =>
  `${area}/${crypto.randomUUID()}.${kind === 'jpeg' ? 'jpg' : 'webp'}`

export const contentTypeOf = (key: string): string =>
  key.endsWith('.webp') ? 'image/webp' : 'image/jpeg'

export interface BlobInfo {
  key: string
  modifiedAt: Date
}

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  /** Every blob of an area, with its last modification time. */
  list(area: Area): Promise<BlobInfo[]>
}

/** Throws unless the key is one of ours (random name, known extension, known area). */
export function assertBlobKey(key: string): void {
  if (!isBlobKey(key)) throw new Error(`invalid blob key: ${key}`)
}
const assertKey = assertBlobKey

export class FsBlobStore implements BlobStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private path(key: string): string {
    assertKey(key)
    const full = resolve(this.root, key)
    if (!full.startsWith(this.root + sep)) throw new Error('blob path escapes the store')
    return full
  }

  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, bytes)
  }

  async get(key: string) {
    const file = Bun.file(this.path(key))
    return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true })
  }

  async list(area: Area): Promise<BlobInfo[]> {
    const dir = join(this.root, area)
    const names = await readdir(dir).catch(() => [] as string[])
    const out: BlobInfo[] = []
    for (const name of names) {
      const key = `${area}/${name}`
      if (!isBlobKey(key)) continue
      const info = await stat(join(dir, name)).catch(() => null)
      if (info) out.push({ key, modifiedAt: info.mtime })
    }
    return out
  }
}

/** For tests: same behaviour, nothing on disk. `modifiedAt` can be set to age a blob. */
export class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, { bytes: Uint8Array; modifiedAt: Date }>()

  async put(key: string, bytes: Uint8Array) {
    assertKey(key)
    this.blobs.set(key, { bytes, modifiedAt: new Date() })
  }

  async get(key: string) {
    assertKey(key)
    return this.blobs.get(key)?.bytes ?? null
  }

  async delete(key: string) {
    assertKey(key)
    this.blobs.delete(key)
  }

  /** Pretends a blob was last modified at `at` (to age it in tests). */
  touch(key: string, at: Date) {
    const blob = this.blobs.get(key)
    if (blob) blob.modifiedAt = at
  }

  async list(area: Area) {
    return [...this.blobs]
      .filter(([key]) => key.startsWith(`${area}/`))
      .map(([key, v]) => ({ key, modifiedAt: v.modifiedAt }))
  }
}
