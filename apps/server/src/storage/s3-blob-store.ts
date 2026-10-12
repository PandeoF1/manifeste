/**
 * Photos in an S3-compatible bucket: Cloudflare R2 in production, MinIO (or any S3 server) in
 * development. Same port as the filesystem store, so nothing else changes.
 *
 * One bucket, two prefixes (`private/` originals awaiting moderation, `public/` blurred photos).
 * The bucket must NOT be public: the API reads it with its own credentials and serves the public
 * photos itself. Add a lifecycle rule expiring `private/` after 2 days as a second net behind the
 * retention sweeper.
 */
import { S3Client } from 'bun'
import {
  assertBlobKey,
  contentTypeOf,
  isBlobKey,
  type Area,
  type BlobInfo,
  type BlobStore,
} from './blob-store.ts'

export interface S3BlobStoreOptions {
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** `https://<account>.r2.cloudflarestorage.com` for R2; unset for AWS S3. */
  endpoint?: string
  /** `auto` for R2. */
  region?: string
  /** Prepended to every key, to share a bucket (`manifeste/`). Empty by default. */
  prefix?: string
  /** Bucket in the host name (`bucket.s3…`) instead of the path. R2 and MinIO use the path. */
  virtualHostedStyle?: boolean
}

/** What S3 answers for a missing object. */
const isMissing = (e: unknown): boolean => {
  const err = e as { code?: string; status?: number; statusCode?: number } | null
  return err?.code === 'NoSuchKey' || err?.status === 404 || err?.statusCode === 404
}

/**
 * A message an operator can act on: Bun's S3 errors often say only "an unexpected error has
 * occurred" and keep the useful part in `code` (ConnectionRefused, DNSResolveFailed, NoSuchBucket,
 * AccessDenied…). Neither the code nor S3's own wording contains a key, a bucket or an endpoint:
 * the readiness probe is public and shows this text.
 */
export function describeS3Error(e: unknown): string {
  const err = e as { code?: string; message?: string } | null
  const message =
    err?.message && err.message !== 'an unexpected error has occurred' ? err.message : ''
  return [err?.code, message].filter(Boolean).join(': ') || 'S3 error'
}

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client
  private readonly prefix: string

  constructor(options: S3BlobStoreOptions) {
    this.prefix = options.prefix ? `${options.prefix.replace(/\/+$/, '')}/` : ''
    this.client = new S3Client({
      bucket: options.bucket,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      region: options.region ?? 'auto',
      virtualHostedStyle: options.virtualHostedStyle ?? false,
      ...(options.endpoint && { endpoint: options.endpoint }),
    })
  }

  private objectKey(key: string): string {
    assertBlobKey(key)
    return `${this.prefix}${key}`
  }

  async put(key: string, bytes: Uint8Array) {
    await this.client.write(this.objectKey(key), bytes, { type: contentTypeOf(key) })
  }

  async get(key: string) {
    try {
      return new Uint8Array(await this.client.file(this.objectKey(key)).arrayBuffer())
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async delete(key: string) {
    // S3 answers 204 whether or not the object existed: deleting twice is fine.
    await this.client.delete(this.objectKey(key))
  }

  async probe(mode: 'read' | 'write') {
    try {
      await this.probeOnce(mode)
    } catch (e) {
      throw new Error(describeS3Error(e), { cause: e })
    }
  }

  private async probeOnce(mode: 'read' | 'write') {
    // One key asked for, not the whole listing: this runs on every readiness check.
    await this.client.list({ prefix: `${this.prefix}public/`, maxKeys: 1 })
    if (mode === 'read') return
    // Own keys, outside the photo areas: the listing and the sweeper never see them.
    const key = `${this.prefix}.probe/${crypto.randomUUID()}`
    await this.client.write(key, new Uint8Array([1]))
    try {
      const back = new Uint8Array(await this.client.file(key).arrayBuffer())
      if (back.length !== 1) throw new Error('probe read back wrong')
    } finally {
      await this.client.delete(key)
    }
  }

  async list(area: Area): Promise<BlobInfo[]> {
    const out: BlobInfo[] = []
    let startAfter: string | undefined
    for (;;) {
      const page = await this.client.list({
        prefix: `${this.prefix}${area}/`,
        maxKeys: 1000,
        ...(startAfter && { startAfter }),
      })
      for (const item of page.contents ?? []) {
        const key = item.key.slice(this.prefix.length)
        if (isBlobKey(key))
          out.push({
            key,
            modifiedAt: item.lastModified ? new Date(item.lastModified) : new Date(),
          })
      }
      const last = page.contents?.at(-1)?.key
      if (!page.isTruncated || !last) return out
      startAfter = last
    }
  }
}
