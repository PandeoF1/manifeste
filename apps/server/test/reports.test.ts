import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { schema } from '@manifeste/db'
import { DAILY_LIMIT } from '@manifeste/core'
import { AnalyticsService } from '../src/modules/analytics/service.ts'
import { PurgeService } from '../src/modules/reports/purge.ts'
import { ReportsService } from '../src/modules/reports/service.ts'
import { newBlobKey } from '../src/storage/blob-store.ts'
import { addReport, addSchool } from './seed.ts'
import { startTestServer, type TestServer } from './helpers.ts'

let s: TestServer
let uai: string
let counter = 0

// A minimal JPEG without metadata (start of scan right after the header).
const cleanJpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00])
// The same with an EXIF segment.
const exifJpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda])

beforeAll(async () => {
  s = await startTestServer()
  uai = await addSchool(s.ctx.db, { name: 'Lycée Pasteur', lat: 50.63, lng: 3.06 })
})
afterAll(() => s.close())

/** A fresh visitor for every call, so tests do not eat each other's daily quota. */
async function send(
  fields: Record<string, string>,
  photo?: Uint8Array,
  ip = `192.0.2.${++counter}`,
) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  if (photo) form.set('photo', new Blob([photo], { type: 'image/jpeg' }), 'photo.jpg')
  const res = await s.request('/api/reports', {
    method: 'POST',
    body: form,
    headers: { 'cf-connecting-ip': ip },
  })
  return { res, body: (await res.json()) as { ok: boolean; error?: string } }
}

const valid = () => ({ schoolUai: uai, status: 'blocked', lat: '50.6312', lng: '3.0589' })

describe('POST /api/reports', () => {
  test('stores a pending, confirmed-tier on-site report with a rounded position', async () => {
    const { res, body } = await send(valid())
    expect(res.status).toBe(201)
    expect(body).toEqual({ ok: true })
    const [report] = await s.ctx.db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.origin, 'on_site'))
    expect(report).toMatchObject({
      schoolUai: uai,
      status: 'blocked',
      moderation: 'pending',
      tier: 'confirmed',
      sourceUrl: null,
    })
    const [priv] = await s.ctx.db.select().from(schema.reportSubmissions)
    expect(priv).toMatchObject({ lat: 50.631, lng: 3.059 })
    expect(priv?.distanceM).toBeLessThan(200)
    // Nothing is public until staff approve it.
    const statuses = (await (await s.request('/api/statuses')).json()) as unknown[]
    expect(statuses).toEqual([])
  })

  test('a photo without metadata is stored privately under a random name', async () => {
    const { res } = await send(valid(), cleanJpeg())
    expect(res.status).toBe(201)
    const keys = (await s.blobs.list('private')).map((b) => b.key)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^private\/[0-9a-f-]{36}\.jpg$/)
    const rows = await s.ctx.db.select().from(schema.reportSubmissions)
    expect(rows.some((r) => r.photoKey === keys[0])).toBe(true)
  })

  test('refuses photos with metadata, of another type, or too big', async () => {
    const before = (await s.blobs.list('private')).length
    expect((await send(valid(), exifJpeg())).body.error).toBe('photo_metadata')
    expect((await send(valid(), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).res.status).toBe(415)
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set([0xff, 0xd8, 0xff])
    expect((await send(valid(), big)).res.status).toBe(413)
    expect((await s.blobs.list('private')).length).toBe(before)
  })

  test('the position must be near the chosen school', async () => {
    expect((await send({ ...valid(), lat: '48.85', lng: '2.35' })).body.error).toBe('too_far')
    expect((await send({ ...valid(), schoolUai: '9999999Z' })).body.error).toBe('unknown_school')
  })

  test('a school missing from the directory becomes a proposal for staff', async () => {
    const { res } = await send({
      newSchoolName: 'Lycée Neuf',
      newSchoolCity: 'Albi',
      status: 'filtering',
      lat: '43.9301',
      lng: '2.1402',
    })
    expect(res.status).toBe(201)
    const [proposal] = await s.ctx.db.select().from(schema.schoolProposals)
    expect(proposal).toMatchObject({
      name: 'Lycée Neuf',
      city: 'Albi',
      status: 'filtering',
      lat: 43.93,
      lng: 2.14,
    })
  })

  test('invalid forms are refused with a code, never stored', async () => {
    const reports = async () => (await s.ctx.db.select().from(schema.reports)).length
    const before = await reports()
    for (const bad of [
      {},
      { ...valid(), status: 'bloque' },
      { ...valid(), lat: '999' },
      { ...valid(), sourceUrl: 'http://x.fr' },
    ]) {
      const { res, body } = await send(bad)
      expect(res.status).toBe(400)
      expect(body).toEqual({ ok: false, error: 'invalid_input' })
    }
    expect(await reports()).toBe(before)
  })

  test(`a visitor gets ${DAILY_LIMIT} reports a day`, async () => {
    const ip = '198.51.100.77'
    for (let i = 0; i < DAILY_LIMIT; i++)
      expect((await send(valid(), undefined, ip)).res.status).toBe(201)
    const sixth = await send(valid(), undefined, ip)
    expect(sixth.res.status).toBe(429)
    expect(sixth.body.error).toBe('rate_limited')
    // Another visitor is not affected.
    expect((await send(valid(), undefined, '198.51.100.78')).res.status).toBe(201)
  })
})

describe('Turnstile', () => {
  const make = (turnstile: ConstructorParameters<typeof ReportsService>[3]) =>
    new ReportsService(s.ctx.db, s.blobs, new AnalyticsService(s.ctx.db), turnstile, {
      error: () => {},
    })
  const raw = (token?: string) => ({ ...valid(), turnstileToken: token })

  test('fails closed in production without a secret', async () => {
    const result = await make({ secret: undefined, production: true }).submit(
      raw(),
      null,
      '192.0.2.200',
    )
    expect(result).toMatchObject({ ok: false, error: 'captcha_failed' })
  })

  test('accepts a token Cloudflare validates, refuses the rest, never sends the IP', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      const body = String(init.body)
      calls.push({ url, body })
      return Response.json({ success: body.includes('response=good') })
    }) as unknown as typeof fetch
    const service = make({ secret: 'secret', production: true, fetchFn })
    expect((await service.submit(raw('good'), null, '192.0.2.201')).ok).toBe(true)
    expect(await service.submit(raw('bad'), null, '192.0.2.202')).toMatchObject({
      error: 'captcha_failed',
    })
    expect(await service.submit(raw(), null, '192.0.2.203')).toMatchObject({
      error: 'captcha_failed',
    })
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c.url).toContain('challenges.cloudflare.com')
      expect(c.body).not.toContain('192.0.2')
    }
  })
})

describe('retention', () => {
  test('originals of decided or stale reports go, undecided fresh ones stay, orphans are swept', async () => {
    const db = s.ctx.db
    const purge = new PurgeService(db, s.blobs)
    const mk = async (moderation: 'pending' | 'approved', ageHours: number) => {
      const id = await addReport(db, { schoolUai: uai, origin: 'on_site', moderation })
      const key = newBlobKey('private', 'jpeg')
      await s.blobs.put(key, cleanJpeg())
      await db
        .insert(schema.reportSubmissions)
        .values({ reportId: id, photoKey: key, lat: 50.6, lng: 3.0, distanceM: 10 })
      await db.execute(
        sql`update report_submissions set created_at = now() - make_interval(hours => ${ageHours}) where report_id = ${id}`,
      )
      await db.execute(
        sql`update reports set created_at = now() - make_interval(hours => ${ageHours}) where id = ${id}`,
      )
      return { id, key }
    }
    const fresh = await mk('pending', 1)
    const decided = await mk('approved', 1)
    const stale = await mk('pending', 50)
    const orphan = newBlobKey('private', 'jpeg')
    await s.blobs.put(orphan, cleanJpeg())
    s.blobs.touch(orphan, new Date(Date.now() - 72 * 3_600_000))
    const proposal = await db
      .insert(schema.schoolProposals)
      .values({ name: 'Old school', city: 'X', status: 'blocked', lat: 1, lng: 1 })
      .returning({ id: schema.schoolProposals.id })
    await db.execute(
      sql`update school_proposals set created_at = now() - interval '8 days' where name = 'Old school'`,
    )

    const result = await purge.run()
    expect(result).toMatchObject({
      photosDeleted: 2,
      reportsRejected: 1,
      proposalsDeleted: 1,
      orphansSwept: 1,
    })
    expect(await s.blobs.get(fresh.key)).not.toBeNull()
    expect(await s.blobs.get(decided.key)).toBeNull()
    expect(await s.blobs.get(stale.key)).toBeNull()
    expect(await s.blobs.get(orphan)).toBeNull()
    const [row] = await db.select().from(schema.reports).where(eq(schema.reports.id, stale.id))
    expect(row?.moderation).toBe('rejected')
    expect(
      (await db.select().from(schema.reports).where(eq(schema.reports.id, fresh.id)))[0]
        ?.moderation,
    ).toBe('pending')
    expect(proposal).toHaveLength(1)
    expect(
      (await db.select().from(schema.schoolProposals)).some((p) => p.name === 'Old school'),
    ).toBe(false)
  })
})

describe('GET /api/photos/:file', () => {
  test('serves published photos, long-lived; refuses private ones and odd names', async () => {
    const key = newBlobKey('public', 'jpeg')
    await s.blobs.put(key, cleanJpeg())
    const res = await s.request(`/api/photos/${key.replace('public/', '')}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('immutable')
    const priv = newBlobKey('private', 'jpeg')
    await s.blobs.put(priv, cleanJpeg())
    expect((await s.request(`/api/photos/${priv.replace('private/', '')}`)).status).toBe(404)
    expect((await s.request('/api/photos/..%2f..%2fetc%2fpasswd')).status).toBeGreaterThanOrEqual(
      400,
    )
    expect((await s.request('/api/photos/not-a-uuid.jpg')).status).toBe(422)
  })
})
