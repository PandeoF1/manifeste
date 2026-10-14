import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import pg from 'pg'
import { schema } from '@manifeste/db'
import { eq, sql } from 'drizzle-orm'
import {
  migrateFromSupabase,
  parseLegacySetting,
  type SourceDb,
} from '../src/migration/supabase.ts'
import { MemoryBlobStore } from '../src/storage/blob-store.ts'
import { startTestServer, type TestServer } from './helpers.ts'

/** A stand-in for the production database: the legacy tables, with a little of everything. */
const BASE = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres'
const name = `legacy_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
let admin: pg.Client
let legacy: pg.Client
let source: SourceDb
let s: TestServer

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const REPORT_ID = '22222222-2222-4222-8222-222222222222'
const PHOTO_REPORT = '33333333-3333-4333-8333-333333333333'

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE })
  await admin.connect()
  await admin.query(`create database ${name}`)
  legacy = new pg.Client({ connectionString: BASE.replace(/\/[^/]*$/, `/${name}`) })
  await legacy.connect()
  await legacy.query(`
    create extension if not exists postgis;
    create table schools (uai text primary key, name text, city text, postcode text, department text, academy text,
      kind text, level text, location geography(Point, 4326));
    create table scrape_sources (id uuid primary key, kind text, identifier text, label text, source_type text,
      trusted boolean, enabled boolean, reports_hidden boolean default false, last_run_at timestamptz, last_error text, created_at timestamptz);
    create table trusted_domains (domain text primary key, label text, kind text);
    create table app_settings (key text primary key, value text);
    create table reports (id uuid primary key, school_uai text, status text, source_type text, source_url text, source_domain text,
      source_id uuid, moderation text, certainty text, photo_public_path text, hidden boolean, observed_at timestamptz, created_at timestamptz,
      published_at timestamptz, extracted_observed_at text, date_basis text,
      judge_score real, judge_nature text, judge_level text, judge_model text, judged_at timestamptz, judge_chars int);
    create table report_submissions (report_id uuid primary key, photo_path text, lat float8, lng float8, distance_m int, created_at timestamptz);
    create table unmatched_extractions (id uuid primary key, source_id uuid, source_domain text, context text, school_name text,
      city text, status text, source_url text, observed_at timestamptz, created_at timestamptz);
    create table school_proposals (id uuid primary key, name text, city text, status text, lat float8, lng float8, photo_path text,
      source_url text, created_at timestamptz);
    create table scraped_items (source_id uuid, external_id text, processed_at timestamptz, primary key (source_id, external_id));
    create table media_analyses (id uuid primary key, url text unique, domain text, title text, source_id uuid, published_at timestamptz,
      about_movement boolean, mentions_demands boolean, demands text[], voices text[], focus text, incidents boolean, police_violence boolean,
      terms text[], tone text, quote_demands text, quote_framing text, model text, text_chars int, analyzed_at timestamptz);
    create table ai_usage (bucket timestamptz, task text, model text, calls int, prompt_tokens bigint, output_tokens bigint, thoughts_tokens bigint,
      primary key (bucket, task, model));
    create table analytics_daily (day date primary key, visitors int);
    create table analytics_pageviews (hour timestamptz, page text, views int, primary key (hour, page));
    create table analytics_new_visitors (slot timestamptz primary key, n int);
    create table analytics_online (minute timestamptz primary key, online int);
    create table analytics_vitals (id bigserial primary key, at timestamptz, page text, metric text, value real);
    create table moderation_audit (id bigserial primary key, at timestamptz, actor_email text, action text, target text, before jsonb, after jsonb);

    insert into schools values
      ('0590001A', 'Lycée Pasteur', 'Lille', '59000', '59', 'Lille', 'Lycée', 'lycee', st_setsrid(st_makepoint(3.06, 50.63), 4326)::geography),
      ('0920002B', 'Université de Nanterre', 'Nanterre', null, '92', 'Versailles', 'Université', 'superieur', null);
    insert into scrape_sources values
      ('${SOURCE_ID}', 'rss', 'https://presse.example/feed', 'Presse', 'presse', true, true, false, now(), null, now()),
      ('44444444-4444-4444-8444-444444444444', 'telegram', 'canal', 'Canal', 'collecteur', false, false, true, null, 'boom', now());
    insert into trusted_domains values ('presse.example', 'Presse', 'presse'), ('syndicat.example', 'Syndicat', 'syndicat');
    insert into app_settings values ('status_ttl_hours', '6'), ('judge_tiers', 'on'), ('judge_keep', '0.6'), ('movement_start', '2026-09-20'), ('status_ttl_hours_old', '9'), ('judge_low', '7');
    insert into reports values
      ('${REPORT_ID}', '0590001A', 'bloque', 'presse', 'https://presse.example/a', 'presse.example', '${SOURCE_ID}', 'validated', 'haute', null, false,
        '2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z', '2026-10-05T06:30:00Z', '2026-10-05', 'extracted', 0.8, 'blocage', 'lycee', 'jev-1.13.0', '2026-10-05T09:00:00Z', 900),
      ('${PHOTO_REPORT}', '0590001A', 'filtrant', 'utilisateur', null, null, null, 'validated', null, '${PHOTO_REPORT}.jpg', false,
        '2026-10-05T08:00:00Z', '2026-10-05T08:05:00Z', null, null, null, null, null, null, null, null, null),
      ('55555555-5555-4555-8555-555555555555', '0920002B', 'leve', 'syndicat', 'https://syndicat.example/x', 'syndicat.example', null, 'pending', 'moyenne', null, true,
        '2026-10-05T09:00:00Z', '2026-10-05T09:00:00Z', null, null, null, 0.2, 'autre', 'lycee', 'jev-1.13.0', '2026-10-05T09:30:00Z', 400),
      ('66666666-6666-4666-8666-666666666666', '0590001A', 'invalid', 'presse', 'https://presse.example/b', 'presse.example', null, 'validated', null, null, false,
        '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', null, null, null, null, null, null, null, null, null);
    insert into report_submissions values ('${PHOTO_REPORT}', 'old/private.jpg', 50.631, 3.061, 40, now());
    insert into unmatched_extractions values ('77777777-7777-4777-8777-777777777777', '${SOURCE_ID}', 'presse.example', 'extrait', 'Lycée Inconnu', 'Nullepart', 'bloque', 'https://presse.example/c', now(), now());
    insert into school_proposals values ('88888888-8888-4888-8888-888888888888', 'Lycée Neuf', 'Lille', 'bloque', 50.6, 3.0, 'p.jpg', null, now());
    insert into scraped_items values ('${SOURCE_ID}', 'guid-recent', now()), ('${SOURCE_ID}', 'guid-old', now() - interval '30 days'), ('99999999-9999-4999-8999-999999999999', 'orphan', now());
    insert into media_analyses values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://presse.example/a', 'presse.example', 'Titre', '${SOURCE_ID}', now(),
      true, true, '{bac}', '{lyceens,police_prefecture}', 'revendications', false, true, '{élèves}', 'neutre', 'q1', null, 'gemini-3.5-flash-lite', 800, now());
    insert into ai_usage values ('2026-10-05T08:00:00Z', 'extraction', 'gemini-3.5-flash-lite', 3, 30000, 6000, 0), ('2026-10-05T08:00:00Z', 'backfill', 'gemini-3.5-flash-lite', 1, 1000, 100, 0);
    insert into analytics_daily values ('2026-10-04', 120);
    insert into analytics_pageviews values ('2026-10-05T08:00:00Z', 'carte', 40), ('2026-10-05T08:00:00Z', 'a-propos', 2);
    insert into analytics_new_visitors values ('2026-10-05T08:05:00Z', 7);
    insert into analytics_online values (now() - interval '1 hour', 12);
    insert into analytics_vitals (at, page, metric, value) values (now(), 'carte', 'LCP', 1800);
    insert into moderation_audit (at, actor_email, action, target, before, after) values (now(), 'old@example.org', 'validate', 'x', null, '{"a":1}');
  `)
  source = { query: async (text, params) => (await legacy.query(text, params)).rows }
  s = await startTestServer()
})
afterAll(async () => {
  await s.close()
  await legacy.end()
  await admin.query(`drop database if exists ${name} with (force)`)
  await admin.end()
})

const counts = async () => ({
  schools: (await s.ctx.db.select().from(schema.schools)).length,
  reports: (await s.ctx.db.select().from(schema.reports)).length,
  sources: (await s.ctx.db.select().from(schema.sources)).length,
})
const byTable = (r: Awaited<ReturnType<typeof migrateFromSupabase>>) =>
  Object.fromEntries(r.tables.map((t) => [t.table.split(' ')[0] as string, t]))

describe('legacy settings', () => {
  test('typed from their text form', () => {
    expect(parseLegacySetting('judge_tiers', 'on')).toBe(true)
    expect(parseLegacySetting('judge_tiers', 'off')).toBe(false)
    expect(parseLegacySetting('status_ttl_hours', '6')).toBe(6)
    expect(parseLegacySetting('movement_start', '2026-09-20')).toBe('2026-09-20')
  })
})

describe('migration from Supabase', () => {
  test('a dry run reports what it would do and writes nothing', async () => {
    const before = await counts()
    const report = await migrateFromSupabase(source, s.ctx.db, { dryRun: true })
    expect(report.dryRun).toBe(true)
    const t = byTable(report)
    expect(t.schools).toMatchObject({ read: 2, inserted: 2 })
    expect(t.sources).toMatchObject({ read: 2, inserted: 2 })
    expect(t['reports'] as unknown).toBeTruthy()
    expect(await counts()).toEqual(before)
  })

  test('a real run carries the data, mapped to the v2 vocabulary', async () => {
    const report = await migrateFromSupabase(source, s.ctx.db, { dryRun: false })
    const t = byTable(report)

    const [nanterre] = await s.ctx.db
      .select()
      .from(schema.schools)
      .where(eq(schema.schools.uai, '0920002B'))
    expect(nanterre).toMatchObject({ level: 'higher', department: '92' })
    const [lille] = await s.ctx.db
      .execute(
        sql`select st_x(location::geometry) as lng, st_y(location::geometry) as lat from schools where uai = '0590001A'`,
      )
      .then((r) => r.rows)
    expect(lille).toMatchObject({ lng: 3.06, lat: 50.63 })

    const sources = await s.ctx.db.select().from(schema.sources)
    expect(sources.find((x) => x.id === SOURCE_ID)).toMatchObject({
      origin: 'press',
      trusted: true,
      kind: 'rss',
    })
    expect(sources.find((x) => x.kind === 'telegram')).toMatchObject({
      origin: 'aggregator',
      enabled: false,
      reportsHidden: true,
      lastError: 'boom',
    })
    expect(
      (await s.ctx.db.select().from(schema.trustedDomains)).map((d) => [d.domain, d.origin]).sort(),
    ).toEqual([
      ['presse.example', 'press'],
      ['syndicat.example', 'union'],
    ])

    // Settings: typed; the one v2 does not know and the out-of-range one are reported, not carried.
    expect(t.settings).toMatchObject({ read: 6, inserted: 4, skipped: 2 })
    const settings = Object.fromEntries(
      (await s.ctx.db.select().from(schema.settings)).map((x) => [x.key, x.value]),
    )
    expect(settings).toMatchObject({
      status_ttl_hours: 6,
      judge_tiers: true,
      judge_keep: 0.6,
      movement_start: '2026-09-20',
    })

    // Reports: statuses, origins and moderation renamed; the unknown status is skipped with a reason.
    expect(t['reports']).toMatchObject({ read: 4, inserted: 3, skipped: 1 })
    expect(t['reports']?.problems[0]).toContain('66666666')
    const reports = await s.ctx.db.select().from(schema.reports)
    const main = reports.find((r) => r.id === REPORT_ID)
    expect(main).toMatchObject({
      status: 'blocked',
      origin: 'press',
      moderation: 'approved',
      certainty: 'high',
      dateBasis: 'extracted',
      sourceId: SOURCE_ID,
      tier: 'confirmed',
    })
    expect(main?.publishedAt?.toISOString()).toBe('2026-10-05T06:30:00.000Z')
    expect(reports.find((r) => r.id === PHOTO_REPORT)).toMatchObject({
      origin: 'on_site',
      status: 'filtering',
      photoKey: `${PHOTO_REPORT}.jpg`,
      tier: 'confirmed',
    })
    const hidden = reports.find((r) => r.moderation === 'pending')
    // Judged 0.2 about a university while saying "lycée": not retained.
    expect(hidden).toMatchObject({ status: 'lifted', hidden: true, tier: 'not_retained' })
    const [judgement] = await s.ctx.db
      .select()
      .from(schema.judgements)
      .where(eq(schema.judgements.reportId, REPORT_ID))
    expect(judgement).toMatchObject({
      provider: 'jev',
      nature: 'blockade',
      level: 'secondary',
      chars: 900,
    })
    const [submission] = await s.ctx.db.select().from(schema.reportSubmissions)
    expect(submission).toMatchObject({ reportId: PHOTO_REPORT, distanceM: 40, photoKey: null })

    // Queues, seen items, analyses, usage, statistics, audit.
    expect(t.unmatched).toMatchObject({ read: 1, inserted: 1 })
    expect(t.school_proposals).toMatchObject({ read: 1, inserted: 1 })
    expect(t.scraped_items).toMatchObject({ read: 2, inserted: 1, skipped: 1 }) // the old one is not read, the orphan is skipped
    const [media] = await s.ctx.db.select().from(schema.mediaAnalyses)
    expect(media).toMatchObject({
      focus: 'demands',
      tone: 'neutral',
      voices: ['students', 'police_prefecture'],
      policeViolence: true,
    })
    const usage = await s.ctx.db.select().from(schema.aiUsage)
    expect(usage).toHaveLength(1) // extraction and backfill share a bucket once renamed
    expect(usage[0]).toMatchObject({ task: 'extract', provider: 'gemini', calls: 4 })
    expect(Number(usage[0]?.costUsd)).toBeGreaterThan(0)
    expect((await s.ctx.db.select().from(schema.analyticsDaily))[0]).toMatchObject({
      day: '2026-10-04',
      visitors: 120,
    })
    expect(
      (await s.ctx.db.select().from(schema.analyticsPageViews)).map((p) => p.page).sort(),
    ).toEqual(['about', 'map'])
    expect(await s.ctx.db.select().from(schema.analyticsVitals)).toHaveLength(1)
    expect(await s.ctx.db.select().from(schema.analyticsNewVisitors)).toMatchObject([{ count: 7 }])
    expect(await s.ctx.db.select().from(schema.analyticsOnline)).toMatchObject([{ online: 12 }])
    expect((await s.ctx.db.select().from(schema.moderationAudit))[0]).toMatchObject({
      action: 'legacy:validate',
      actorEmail: 'old@example.org',
    })
  })

  test('running it again changes nothing: it is safe to repeat', async () => {
    const before = await counts()
    const again = await migrateFromSupabase(source, s.ctx.db, { dryRun: false })
    expect(await counts()).toEqual(before)
    const t = byTable(again)
    expect(t.schools).toMatchObject({ inserted: 0, updated: 2 })
    expect(t['reports']).toMatchObject({ inserted: 0, updated: 3 })
    expect(await s.ctx.db.select().from(schema.moderationAudit)).toHaveLength(1)
    expect(await s.ctx.db.select().from(schema.analyticsVitals)).toHaveLength(1)
    expect(await s.ctx.db.select().from(schema.unmatched)).toHaveLength(1)
  })

  test('statistics that kept counting in the old system are brought up to date', async () => {
    await legacy.query(`
      update analytics_pageviews set views = 55 where page = 'carte';
      insert into analytics_vitals (at, page, metric, value) values (now(), 'carte', 'LCP', 2100);`)
    await migrateFromSupabase(source, s.ctx.db, { dryRun: false })
    const views = await s.ctx.db.select().from(schema.analyticsPageViews)
    expect(views.find((v) => v.page === 'map')?.views).toBe(55)
    expect(await s.ctx.db.select().from(schema.analyticsVitals)).toHaveLength(2)
    await legacy.query(`update analytics_pageviews set views = 40 where page = 'carte'`)
    await migrateFromSupabase(source, s.ctx.db, { dryRun: false })
    const after = await s.ctx.db.select().from(schema.analyticsPageViews)
    expect(after.find((v) => v.page === 'map')?.views).toBe(55) // never goes down
  })

  test('the delta since the last run is carried: a decision taken in the old system arrives', async () => {
    await legacy.query(
      `update reports set moderation = 'rejected', hidden = true where id = '${REPORT_ID}'`,
    )
    await legacy.query(
      `insert into reports select '${crypto.randomUUID()}', school_uai, 'bloque', source_type, 'https://presse.example/new', source_domain, source_id, 'validated', certainty, null, false, now(), now(), null, null, null, null, null, null, null, null, null from reports where id = '${REPORT_ID}'`,
    )
    const report = await migrateFromSupabase(source, s.ctx.db, { dryRun: false })
    expect(byTable(report)['reports']).toMatchObject({ inserted: 1, updated: 3 })
    const [r] = await s.ctx.db.select().from(schema.reports).where(eq(schema.reports.id, REPORT_ID))
    expect(r).toMatchObject({ moderation: 'rejected', hidden: true })
  })

  test('published photos are copied once, and only counted in a dry run', async () => {
    const blobs = new MemoryBlobStore()
    const asked: string[] = []
    const fetchFn = (async (url: string) => {
      asked.push(url)
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
    }) as unknown as typeof fetch
    const options = {
      publicBaseUrl: 'https://x.supabase.co/storage/v1/object/public/photos/',
      blobs,
      fetchFn,
    }
    const dry = await migrateFromSupabase(source, s.ctx.db, { dryRun: true, photos: options })
    expect(byTable(dry)['published']).toMatchObject({ read: 1, inserted: 1 })
    expect(asked).toEqual([])
    await migrateFromSupabase(source, s.ctx.db, { dryRun: false, photos: options })
    expect(asked).toEqual([
      `https://x.supabase.co/storage/v1/object/public/photos/${PHOTO_REPORT}.jpg`,
    ])
    expect(await blobs.get(`public/${PHOTO_REPORT}.jpg`)).not.toBeNull()
    await migrateFromSupabase(source, s.ctx.db, { dryRun: false, photos: options })
    expect(asked).toHaveLength(1)
  })
})

describe('shadow comparison', () => {
  test('agreements, what only the old system had, what only v2 has', async () => {
    const { compareShadow } = await import('../src/migration/shadow.ts')
    // v2 has what was migrated, plus one report the old system never saw; and misses one.
    await s.ctx.db
      .delete(schema.reports)
      .where(eq(schema.reports.sourceUrl, 'https://presse.example/new'))
    await s.ctx.db.insert(schema.reports).values({
      schoolUai: '0920002B',
      status: 'blocked',
      origin: 'press',
      sourceUrl: 'https://nouveau.example/z',
      sourceDomain: 'nouveau.example',
      moderation: 'approved',
      observedAt: new Date('2026-10-06T08:00:00Z'),
    })
    const r = await compareShadow(source, s.ctx.db, new Date('2026-10-01T00:00:00Z'))
    expect(r.onlyLegacy.map((x) => [x.uai, x.status])).toContainEqual(['0590001A', 'blocked'])
    expect(r.onlyV2.map((x) => [x.uai, x.source])).toContainEqual(['0920002B', 'nouveau.example'])
    expect(r.agree).toBeGreaterThanOrEqual(0)
    // On-site reports never count: the old system and v2 do not collect them.
    expect(r.onlyLegacy.some((x) => x.source === null)).toBe(false)
  })
})

describe('a row the target refuses', () => {
  const BAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const GOOD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let fresh: TestServer

  beforeAll(async () => {
    // A hand-added school (made-up UAI), a report whose link is not https (a CHECK of v2 refuses
    // it) and, after it, a perfectly good one.
    await legacy.query(`
      insert into schools values
        ('9990007Z', 'Lycée Ajouté', 'Lille', null, '59', 'Lille', 'ajouté', 'lycee', null);
      insert into reports (id, school_uai, status, source_type, source_url, source_domain, source_id, moderation, hidden, observed_at, created_at)
      values
        ('${BAD}', '0590001A', 'bloque', 'presse', 'http://presse.example/not-https', 'presse.example', null, 'validated', false, now(), now()),
        ('${GOOD}', '0590001A', 'bloque', 'presse', 'https://presse.example/good-after-bad', 'presse.example', null, 'validated', false, now(), now());
    `)
    fresh = await startTestServer()
  })
  afterAll(async () => {
    await fresh.close()
  })

  test('is reported and skipped; the rows after it are still carried', async () => {
    const report = await migrateFromSupabase(source, fresh.ctx.db, { dryRun: false })
    const t = byTable(report)
    expect(t['reports']?.problems.some((p) => p.includes(BAD))).toBe(true)
    // Before the fix the first refused row aborted the transaction: everything after it failed
    // and the final COMMIT became a ROLLBACK, with a report still counting "inserted" rows.
    const stored = await fresh.ctx.db.select({ id: schema.reports.id }).from(schema.reports)
    const ids = stored.map((r) => r.id)
    expect(ids).toContain(GOOD)
    expect(ids).toContain(REPORT_ID)
    expect(ids).not.toContain(BAD)
    expect(t['reports']?.inserted).toBe(ids.length)
  })

  test('the hand-added school counter moves past the migrated UAIs', async () => {
    const [next] = (await fresh.ctx.db.execute(sql`select nextval('custom_school_seq')::int as n`))
      .rows as Array<{ n: number }>
    expect(next?.n).toBe(8)
  })

  test('a dry run reports the move but does not make it', async () => {
    await legacy.query(
      `insert into schools values ('9990020Z', 'Autre', 'Lille', null, '59', 'Lille', 'ajouté', 'lycee', null)`,
    )
    const report = await migrateFromSupabase(source, fresh.ctx.db, { dryRun: true })
    expect(byTable(report)['custom_school_seq']?.problems[0]).toContain('would move')
    const [after] = (await fresh.ctx.db.execute(sql`select nextval('custom_school_seq')::int as n`))
      .rows as Array<{ n: number }>
    expect(after?.n).toBe(9)
  })
})
