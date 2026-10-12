import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { newBlobKey } from '../src/storage/blob-store.ts'
import { signInStaff, startTestServer, type TestServer } from './helpers.ts'
import { addReport, addSchool } from './seed.ts'

let s: TestServer
let admin: { cookie: string }
let moderator: { cookie: string }
let uai: string

/** A tiny JPEG with no metadata segment (what the report form's canvas produces). */
const CLEAN_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9])
/** The same with an EXIF (APP1) segment. */
const EXIF_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02, 0xff, 0xd9])

beforeAll(async () => {
  s = await startTestServer()
  admin = { cookie: await signInStaff(s, 'admin@example.org', 'admin') }
  moderator = { cookie: await signInStaff(s, 'mod@example.org', 'moderator') }
  uai = await addSchool(s.ctx.db, { name: 'Lycée Pasteur', city: 'Lille' })
})
afterAll(() => s.close())

const as = (who: { cookie: string }, path: string, init: RequestInit & { json?: unknown } = {}) =>
  s.request(path, { ...init, headers: { ...(init.headers as object), cookie: who.cookie } })

/** An on-site report waiting for a decision, with its private original photo. */
async function pendingOnSite() {
  const photoKey = newBlobKey('private', 'jpeg')
  await s.blobs.put(photoKey, EXIF_JPEG)
  const id = await addReport(s.ctx.db, {
    schoolUai: uai,
    origin: 'on_site',
    moderation: 'pending',
    hoursAgo: 1,
  })
  await s.ctx.db
    .insert(schema.reportSubmissions)
    .values({ reportId: id, lat: 50.6, lng: 3.06, distanceM: 40, photoKey })
  return { id, photoKey }
}

const decision = (decision: 'approve' | 'reject', photo?: Uint8Array) => {
  const form = new FormData()
  form.set('decision', decision)
  if (photo) form.set('photo', new File([photo], 'blurred.jpg', { type: 'image/jpeg' }))
  return { method: 'POST', body: form } as const
}

describe('access', () => {
  test('visitors are refused; moderators have the queue but not the edits', async () => {
    expect((await s.request('/api/staff/reports/pending')).status).toBe(401)
    expect((await as(moderator, '/api/staff/reports/pending')).status).toBe(200)
    expect((await as(moderator, '/api/staff/reports')).status).toBe(403)
    const id = await addReport(s.ctx.db, { schoolUai: uai })
    expect(
      (
        await as(moderator, `/api/staff/reports/${id}`, {
          method: 'PATCH',
          json: { status: 'lifted' },
        })
      ).status,
    ).toBe(403)
    expect((await as(moderator, `/api/staff/reports/${id}`, { method: 'DELETE' })).status).toBe(403)
    expect(
      (
        await as(moderator, `/api/staff/reports/${id}/hidden`, {
          method: 'POST',
          json: { hidden: true },
        })
      ).status,
    ).toBe(403)
  })
})

describe('the queue', () => {
  test('moderators see no internal source; admins do', async () => {
    const [src] = await s.ctx.db
      .insert(schema.sources)
      .values({ kind: 'rss', identifier: 'https://p.example/feed', label: 'Press feed' })
      .returning({ id: schema.sources.id })
    const id = await addReport(s.ctx.db, {
      schoolUai: uai,
      moderation: 'pending',
      sourceId: src?.id ?? null,
    })
    const find = async (who: { cookie: string }) => {
      const rows = (await (await as(who, '/api/staff/reports/pending')).json()) as Array<{
        id: string
        sourceLabel: string | null
        schoolName: string
      }>
      return rows.find((r) => r.id === id)
    }
    expect(await find(admin)).toMatchObject({
      sourceLabel: 'Press feed',
      schoolName: 'Lycée Pasteur',
    })
    expect(await find(moderator)).toMatchObject({ sourceLabel: null, schoolName: 'Lycée Pasteur' })
  })

  test('an on-site report shows its distance and that it has a photo', async () => {
    const { id } = await pendingOnSite()
    const rows = (await (await as(moderator, '/api/staff/reports/pending')).json()) as Array<{
      id: string
      distanceM: number
      hasPhoto: boolean
      origin: string
    }>
    expect(rows.find((r) => r.id === id)).toMatchObject({
      distanceM: 40,
      hasPhoto: true,
      origin: 'on_site',
    })
  })
})

describe('searching the reports', () => {
  test('the search text is literal: "%" and "_" are not wildcards', async () => {
    await addReport(s.ctx.db, { schoolUai: uai, sourceDomain: 'press.example' })
    const list = async (q: string) =>
      (await (await as(admin, `/api/staff/reports?q=${encodeURIComponent(q)}`)).json()) as unknown[]
    expect((await list('pasteur')).length).toBeGreaterThan(0)
    // A wildcard would match every report (and scan the table for it).
    expect(await list('%')).toEqual([])
    expect(await list('_')).toEqual([])
    expect(await list('pas_eur')).toEqual([])
  })
})

describe('two moderators on the same report', () => {
  test('only one decision wins; the other is told, and its photo is not left behind', async () => {
    const { id } = await pendingOnSite()
    const before = s.blobs.blobs.size
    const [a, b] = await Promise.all([
      as(moderator, `/api/staff/reports/${id}/decision`, decision('approve', CLEAN_JPEG)),
      as(moderator, `/api/staff/reports/${id}/decision`, decision('approve', CLEAN_JPEG)),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    // Exactly one published photo: the loser deleted the one it had stored.
    const published = [...s.blobs.blobs.keys()].filter((k) => k.startsWith('public/'))
    expect(published).toHaveLength(1)
    expect(s.blobs.blobs.size).toBeLessThanOrEqual(before + 1)
  })
})

describe('decisions', () => {
  test('approve with a blurred photo: published, original deleted, photo served publicly', async () => {
    const { id, photoKey } = await pendingOnSite()
    const original = await as(moderator, `/api/staff/reports/${id}/original-photo`)
    expect(original.status).toBe(200)
    expect(original.headers.get('cache-control')).toBe('private, no-store')

    const res = await as(
      moderator,
      `/api/staff/reports/${id}/decision`,
      decision('approve', CLEAN_JPEG),
    )
    expect(res.status).toBe(200)
    const [report] = await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id))
    expect(report).toMatchObject({ moderation: 'approved' })
    expect(report?.photoKey).toMatch(/^[0-9a-f-]{36}\.jpg$/)
    expect(report?.moderatedBy).toBeTruthy()
    expect(await s.blobs.get(photoKey)).toBeNull() // the original is gone
    expect((await s.request(`/api/photos/${report?.photoKey}`)).status).toBe(200)
    expect((await as(moderator, `/api/staff/reports/${id}/original-photo`)).status).toBe(404)
  })

  test('a photo that still carries metadata is refused, and the report stays pending', async () => {
    const { id } = await pendingOnSite()
    expect(
      (await as(moderator, `/api/staff/reports/${id}/decision`, decision('approve', EXIF_JPEG)))
        .status,
    ).toBe(422)
    expect(
      (
        await as(
          moderator,
          `/api/staff/reports/${id}/decision`,
          decision('approve', new Uint8Array([1, 2, 3])),
        )
      ).status,
    ).toBe(422)
    const [report] = await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id))
    expect(report?.moderation).toBe('pending')
  })

  test('reject deletes the original, and a decided report cannot be decided again', async () => {
    const { id, photoKey } = await pendingOnSite()
    expect(
      (await as(moderator, `/api/staff/reports/${id}/decision`, decision('reject'))).status,
    ).toBe(200)
    expect(await s.blobs.get(photoKey)).toBeNull()
    expect(
      (await as(moderator, `/api/staff/reports/${id}/decision`, decision('approve'))).status,
    ).toBe(409)
    expect(
      (
        await as(
          moderator,
          `/api/staff/reports/${crypto.randomUUID()}/decision`,
          decision('approve'),
        )
      ).status,
    ).toBe(404)
  })

  test('decisions are audited and tell the realtime bus', async () => {
    const seen: string[] = []
    const off = s.ctx.bus.subscribe((e) => seen.push(e.topic))
    await s.ctx.bus.start()
    const { id } = await pendingOnSite()
    await as(moderator, `/api/staff/reports/${id}/decision`, decision('approve'))
    await new Promise((r) => setTimeout(r, 300))
    off()
    await s.ctx.bus.stop()
    expect(seen).toContain('statuses')
    const lines = await s.ctx.db
      .select()
      .from(schema.moderationAudit)
      .where(eq(schema.moderationAudit.target, id))
    expect(lines.map((l) => l.action)).toEqual(['report.approve'])
    expect(lines[0]?.actorEmail).toBe('mod@example.org')
  })
})

describe('edits', () => {
  test('the list filters by state and text; a patch changes school, status and time', async () => {
    const other = await addSchool(s.ctx.db, { name: 'Lycée Curie', city: 'Marseille' })
    const id = await addReport(s.ctx.db, {
      schoolUai: uai,
      moderation: 'approved',
      sourceDomain: 'unique-domain.example',
    })
    const hit = (await (await as(admin, '/api/staff/reports?q=unique-domain')).json()) as Array<{
      id: string
    }>
    expect(hit.map((r) => r.id)).toEqual([id])

    const when = new Date('2026-10-05T07:00:00Z')
    const res = await as(admin, `/api/staff/reports/${id}`, {
      method: 'PATCH',
      json: { schoolUai: other, status: 'lifted', observedAt: when.toISOString() },
    })
    expect(res.status).toBe(200)
    const [report] = await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id))
    expect(report).toMatchObject({ schoolUai: other, status: 'lifted' })
    expect(report?.observedAt.toISOString()).toBe(when.toISOString())
    expect(
      (
        await as(admin, `/api/staff/reports/${id}`, {
          method: 'PATCH',
          json: { schoolUai: '0000000Z' },
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await as(admin, `/api/staff/reports/${crypto.randomUUID()}`, {
          method: 'PATCH',
          json: { status: 'lifted' },
        })
      ).status,
    ).toBe(404)
  })

  test('changing the status recomputes the tier from the judge answer', async () => {
    const id = await addReport(s.ctx.db, { schoolUai: uai, status: 'blocked', tier: 'confirmed' })
    await s.ctx.db.insert(schema.judgements).values({
      reportId: id,
      provider: 'jev',
      model: 'jev',
      probability: 0.8,
      nature: 'gathering',
    })
    // gathering at 0.8: confirmed only for "lifted"; a blocked report is a mobilisation.
    await as(admin, `/api/staff/reports/${id}`, { method: 'PATCH', json: { status: 'filtering' } })
    expect(
      (await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id)))[0]?.tier,
    ).toBe('mobilisation')
    await as(admin, `/api/staff/reports/${id}`, { method: 'PATCH', json: { status: 'lifted' } })
    expect(
      (await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id)))[0]?.tier,
    ).toBe('confirmed')
  })

  test('hide, unhide, delete (with the public photo)', async () => {
    const id = await addReport(s.ctx.db, { schoolUai: uai })
    await as(admin, `/api/staff/reports/${id}/hidden`, { method: 'POST', json: { hidden: true } })
    expect(
      (await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id)))[0]?.hidden,
    ).toBe(true)
    await as(admin, `/api/staff/reports/${id}/hidden`, { method: 'POST', json: { hidden: false } })
    expect(
      (await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id)))[0]?.hidden,
    ).toBe(false)

    const publicKey = newBlobKey('public', 'jpeg')
    await s.blobs.put(publicKey, CLEAN_JPEG)
    await s.ctx.db
      .update(schema.reports)
      .set({ photoKey: publicKey.slice('public/'.length) })
      .where(eq(schema.reports.id, id))
    expect((await as(admin, `/api/staff/reports/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(
      await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id)),
    ).toHaveLength(0)
    expect(await s.blobs.get(publicKey)).toBeNull()
    const actions = (
      await s.ctx.db
        .select()
        .from(schema.moderationAudit)
        .where(eq(schema.moderationAudit.target, id))
    ).map((a) => a.action)
    expect(actions).toEqual(['report.hide', 'report.unhide', 'report.delete'])
  })

  test('a collected report sent back to the queue becomes an unmatched fact, and is withdrawn', async () => {
    const [src] = await s.ctx.db
      .insert(schema.sources)
      .values({ kind: 'rss', identifier: 'https://q.example/feed', label: 'Q' })
      .returning({ id: schema.sources.id })
    const id = await addReport(s.ctx.db, {
      schoolUai: uai,
      sourceId: src?.id ?? null,
      sourceDomain: 'q.example',
    })
    expect(
      (await as(admin, `/api/staff/reports/${id}/to-unmatched`, { method: 'POST' })).status,
    ).toBe(200)
    expect(
      await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, id)),
    ).toHaveLength(0)
    const rows = await s.ctx.db
      .select()
      .from(schema.unmatched)
      .where(eq(schema.unmatched.sourceId, src?.id ?? ''))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ schoolName: 'Lycée Pasteur', city: 'Lille', status: 'blocked' })
    const onSite = await addReport(s.ctx.db, { schoolUai: uai, origin: 'on_site' })
    expect(
      (await as(admin, `/api/staff/reports/${onSite}/to-unmatched`, { method: 'POST' })).status,
    ).toBe(422)
  })
})
