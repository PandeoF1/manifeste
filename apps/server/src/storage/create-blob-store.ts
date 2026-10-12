import { FsBlobStore, type BlobStore } from './blob-store.ts'
import { S3BlobStore } from './s3-blob-store.ts'

export interface BlobStoreConfig {
  BLOB_STORE: 'fs' | 's3'
  DATA_DIR: string
  S3_BUCKET?: string | undefined
  S3_ACCESS_KEY_ID?: string | undefined
  S3_SECRET_ACCESS_KEY?: string | undefined
  S3_ENDPOINT?: string | undefined
  S3_REGION: string
  S3_PREFIX?: string | undefined
  S3_VIRTUAL_HOSTED: boolean
}

/** The store the configuration asks for. */
export function createBlobStore(config: BlobStoreConfig): BlobStore {
  if (config.BLOB_STORE === 'fs') return new FsBlobStore(config.DATA_DIR)
  return new S3BlobStore({
    bucket: config.S3_BUCKET ?? '',
    accessKeyId: config.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '',
    region: config.S3_REGION,
    virtualHostedStyle: config.S3_VIRTUAL_HOSTED,
    ...(config.S3_ENDPOINT && { endpoint: config.S3_ENDPOINT }),
    ...(config.S3_PREFIX && { prefix: config.S3_PREFIX }),
  })
}
