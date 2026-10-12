import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { schema } from '@manifeste/db'
import { PurgeService } from '../src/modules/reports/purge.ts'
import { S3BlobStore } from '../src/storage/s3-blob-store.ts'
import { addSchool } from './seed.ts'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'

/**
 * The whole life of a photo with an S3 bucket instead of the volume: sent by a visitor (private),
 * approved with its blurred version (public), served by the API, original gone.
 * Needs TEST_S3_ENDPOINT (see blob-store.test.ts).
 */
const endpoint = process.env.TEST_S3_ENDPOINT
const CLEAN_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])

describe.skipIf(!endpoint)('photos in an S3 bucket', () => {
  let s: TestServer
  let store: S3BlobStore
  let uai: string
  let cookie: string

  beforeAll(async () => {
    store = new S3BlobStore({
      bucket: process.env.TEST_S3_BUCKET ?? 'manifeste-test',
      accessKeyId: process.env.TEST_S3_KEY ?? 'test',
      secretAccessKey: process.env.TEST_S3_SECRET ?? 'test',
      endpoint: endpoint ?? '',
      region: 'us-east-1',
      prefix: `e2e-${crypto.randomUUID()}`,
    })
    s = await startTestServer({}, { blobs: store })
    uai = await addSchool(s.ctx.db, { name: 'Lycée Pasteur', city: 'Lille', lat: 50.63, lng: 3.06 })
    cookie = await signInStaff(s, 'mod@example.org', 'moderator')
  })
  afterAll(() => s.close())

  test('upload, moderation, public serving and deletion of the original', async () => {
    const form = new FormData()
    for (const [k, v] of Object.entries({
      schoolUai: uai,
      status: 'blocked',
      lat: '50.6312',
      lng: '3.0589',
    }))
      form.set(k, v)
    form.set('photo', new Blob([CLEAN_JPEG], { type: 'image/jpeg' }), 'photo.jpg')
    const sent = await s.request('/api/reports', {
      method: 'POST',
      body: form,
      headers: { 'cf-connecting-ip': '192.0.2.77' },
    })
    expect(sent.status).toBe(201)

    // The original sits in the bucket, under a random private name.
    const [original] = await store.list('private')
    expect(original?.key).toMatch(/^private\/[0-9a-f-]{36}\.jpg$/)
    expect(await store.get(original?.key ?? '')).toEqual(CLEAN_JPEG)

    const [report] = await s.ctx.db
      .select({ id: schema.reports.id })
      .from(schema.reports)
      .where(eq(schema.reports.origin, 'on_site'))
    const blurred = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])
    const decision = new FormData()
    decision.set('decision', 'approve')
    decision.set('photo', new File([blurred], 'blurred.jpg', { type: 'image/jpeg' }))
    const approved = await s.request(`/api/staff/reports/${report?.id}/decision`, {
      method: 'POST',
      body: decision,
      headers: { cookie },
    })
    expect(approved.status).toBe(200)

    // The blurred copy is public; the original is gone from the bucket.
    const [published] = await s.ctx.db
      .select({ photoKey: schema.reports.photoKey })
      .from(schema.reports)
      .where(eq(schema.reports.id, report?.id ?? ''))
    const photoKey = published?.photoKey
    expect(photoKey).toMatch(/^[0-9a-f-]{36}\.jpg$/)
    expect(await store.list('private')).toHaveLength(0)
    expect((await store.list('public')).map((p) => p.key)).toEqual([`public/${photoKey}`])

    const served = await s.request(`/api/photos/${photoKey}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/jpeg')
    expect(served.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(blurred)

    // The private area is not reachable from outside, whatever the name.
    expect((await s.request(`/api/photos/${original?.key.slice('private/'.length)}`)).status).toBe(
      404,
    )
  })

  test('the retention sweeper runs against the bucket', async () => {
    const purge = await new PurgeService(s.ctx.db, store).run()
    expect(purge.orphansSwept).toBe(0) // nothing is 48 h old yet
  })
})
