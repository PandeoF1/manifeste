/**
 * Moves the photos of a deployment from the volume to the S3 bucket (the S3_* variables must be
 * set), or the other way round with --reverse. Dry run unless --run.
 *
 *   bun copy-blobs.js            what would be copied
 *   bun copy-blobs.js --run      copy it (repeatable: what is already there is skipped)
 *   bun copy-blobs.js --run --reverse   bucket -> volume, to go back
 *
 * Do it before switching BLOB_STORE=s3 so the published photos follow; the private originals
 * (48 h at most) can be left behind.
 */
import { loadConfig } from '../config.ts'
import { FsBlobStore } from '../storage/blob-store.ts'
import { copyBlobs } from '../storage/copy.ts'
import { createBlobStore } from '../storage/create-blob-store.ts'

const args = new Set(process.argv.slice(2))
const run = args.has('--run')
const config = loadConfig({ ...process.env, BLOB_STORE: 's3' })
const volume = new FsBlobStore(config.DATA_DIR)
const bucket = createBlobStore(config)
const [from, to] = args.has('--reverse') ? [bucket, volume] : [volume, bucket]

const results = await copyBlobs(from, to, { dryRun: !run })
for (const r of results) {
  console.log(
    `${r.area}: ${r.found} found, ${r.copied} ${run ? 'copied' : 'to copy'} (${(r.bytes / 1e6).toFixed(1)} MB), ${r.alreadyThere} already there, ${r.failed.length} failed`,
  )
  for (const f of r.failed) console.error(`  ${f.key}: ${f.error}`)
}
if (!run) console.log('Dry run. Add --run to copy.')
process.exit(results.some((r) => r.failed.length > 0) ? 1 : 0)
