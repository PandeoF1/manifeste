/**
 * One-way, repeatable copy of the production Supabase data into the v2 database.
 *
 * Repeatable: every table is an upsert by its identifier, so the script can be run for a rehearsal,
 * again for the shadow run, and a last time at the cutover to carry the delta. `dryRun` does the
 * whole work inside a transaction that is rolled back, so its counts are exactly what a real run
 * would do, with nothing written.
 *
 * What is carried: the school directory (hand-added schools included), sources, trusted domains,
 * settings, reports with their judge opinions, the staff queues (unmatched facts, proposed
 * schools), the last days of seen items (so nothing is analysed twice), media analyses, AI usage,
 * site statistics and the moderation audit. Published photos can be copied too.
 *
 * What is not: staff accounts (re-invite them: better-auth has its own users and a second factor),
 * private photos (deleted within 48 h anyway), article text, collector logs.
 */
import { createHash } from 'node:crypto'
import { isSettingKey, isValidSetting, readSettings, tierOf, type Settings } from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { DEFAULT_PRICES, costOf } from '@manifeste/ai'
import { sql } from 'drizzle-orm'
import type { BlobStore } from '../storage/blob-store.ts'

/** The legacy database, read-only: anything with a `query`. */
export interface SourceDb {
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
}

export interface MigrationOptions {
  dryRun: boolean
  /** Seen items older than this are not carried (the collector only looks back 48 h). */
  seenDays?: number
  /** Copy the published (blurred) photos from the legacy storage bucket. */
  photos?: { publicBaseUrl: string; blobs: BlobStore; fetchFn?: typeof fetch }
}

export interface TableReport {
  table: string
  read: number
  inserted: number
  updated: number
  skipped: number
  problems: string[]
}

export interface MigrationReport {
  dryRun: boolean
  tables: TableReport[]
}

class DryRunRollback extends Error {}

type Row = Record<string, unknown>
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

const str = (v: unknown): string | null => (v == null ? null : String(v))
const num = (v: unknown): number => (v == null ? 0 : Number(v))
const date = (v: unknown): Date | null => (v == null ? null : new Date(v as string | Date))
const BATCH = 500

const ORIGIN: Record<string, 'press' | 'union' | 'aggregator' | 'on_site'> = {
  presse: 'press',
  syndicat: 'union',
  collecteur: 'aggregator',
  utilisateur: 'on_site',
}
const STATUS: Record<string, 'blocked' | 'filtering' | 'lifted'> = {
  bloque: 'blocked',
  filtrant: 'filtering',
  leve: 'lifted',
}
const MODERATION: Record<string, 'approved' | 'pending' | 'rejected'> = {
  validated: 'approved',
  pending: 'pending',
  rejected: 'rejected',
}
const CERTAINTY: Record<string, 'high' | 'medium' | 'low'> = {
  haute: 'high',
  moyenne: 'medium',
  faible: 'low',
}
const NATURE: Record<string, 'blockade' | 'closed' | 'gathering' | 'incident' | 'other'> = {
  blocage: 'blockade',
  ferme: 'closed',
  rassemblement: 'gathering',
  incident: 'incident',
  autre: 'other',
}
const LEVEL: Record<string, 'secondary' | 'higher' | 'unknown'> = {
  lycee: 'secondary',
  superieur: 'higher',
  inconnu: 'unknown',
}
const MEDIA_FOCUS: Record<string, string> = {
  revendications: 'demands',
  mobilisation: 'mobilisation',
  incidents: 'incidents',
  mixte: 'mixed',
}
const MEDIA_TONE: Record<string, string> = {
  favorable: 'favourable',
  neutre: 'neutral',
  defavorable: 'unfavourable',
}
const MEDIA_VOICE: Record<string, string> = {
  lyceens: 'students',
  enseignants_syndicats: 'teachers_unions',
  parents: 'parents',
  direction_rectorat: 'school_authorities',
  police_prefecture: 'police_prefecture',
  politiques: 'politicians',
}
const AI_TASK: Record<string, string> = {
  extraction: 'extract',
  backfill: 'extract',
  media: 'media',
  reanalyse: 'reanalyse',
  judge: 'judge',
}
const PAGE: Record<string, 'map' | 'list' | 'school' | 'report' | 'about' | 'data' | 'other'> = {
  carte: 'map',
  liste: 'list',
  lycee: 'school',
  signaler: 'report',
  'a-propos': 'about',
  donnees: 'data',
  autre: 'other',
}
const DATE_BASIS = new Set(['extracted', 'announced', 'published'])

function report(table: string): TableReport {
  return { table, read: 0, inserted: 0, updated: 0, skipped: 0, problems: [] }
}

/** Counts what an upsert did, using Postgres' `xmax = 0` marker of a fresh insert. */
function tally(r: TableReport, rows: Array<{ fresh: boolean }>) {
  for (const row of rows) {
    if (row.fresh) r.inserted++
    else r.updated++
  }
}

/**
 * Runs one row's writes in a SAVEPOINT. Postgres aborts the whole transaction on the first error
 * unless the statement sits in a savepoint: without it, a single rejected row (a CHECK, a unique
 * index) made every later statement fail, the swallowed errors looked like "skipped" rows, and the
 * final COMMIT silently turned into a ROLLBACK while the report still claimed inserts.
 * Returns null (and records the problem) when the row is rejected; the rest carries on.
 */
async function rowAttempt<T>(
  tx: Tx,
  r: TableReport,
  label: string,
  write: (savepoint: Tx) => Promise<T>,
): Promise<T | null> {
  try {
    return await tx.transaction((savepoint) => write(savepoint as Tx))
  } catch (e) {
    r.problems.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    r.skipped++
    return null
  }
}

const chunks = <T>(list: readonly T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += BATCH) out.push(list.slice(i, i + BATCH))
  return out
}

export async function migrateFromSupabase(
  source: SourceDb,
  target: Database,
  options: MigrationOptions,
): Promise<MigrationReport> {
  const tables: TableReport[] = []
  let sequence = { report: report('custom_school_seq'), wanted: 0 }
  try {
    await target.transaction(async (tx) => {
      tables.push(await schools(source, tx))
      sequence = await sequencePlan(tx)
      const sourceIds = new Set<string>()
      tables.push(await sources(source, tx, sourceIds))
      tables.push(await trustedDomains(source, tx))
      const settings = await settingsTable(source, tx, tables)
      tables.push(await reports(source, tx, settings))
      tables.push(await unmatched(source, tx))
      tables.push(await proposals(source, tx))
      tables.push(await seenItems(source, tx, options.seenDays ?? 7))
      tables.push(await media(source, tx))
      tables.push(await aiUsage(source, tx))
      tables.push(...(await analytics(source, tx)))
      tables.push(await audit(source, tx))
      if (options.photos) tables.push(await photos(source, options.photos, options.dryRun))
      if (options.dryRun) throw new DryRunRollback()
    })
    if (sequence.wanted > 0) {
      await target.execute(sql`select setval('custom_school_seq', ${sequence.wanted}, true)`)
      sequence.report.problems = []
      sequence.report.updated = 1
    }
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e
  }
  tables.push(sequence.report)
  return { dryRun: options.dryRun, tables }
}

/**
 * Hand-added schools carry a made-up UAI, 999NNNNZ, drawn from `custom_school_seq`. The migration
 * copies those schools but not the counter, so v2 would start again at 9990001Z and the first
 * school a staff member created would collide with a migrated one (primary key error). The counter
 * is moved up to the highest number in use, never down. A sequence is not transactional: the need
 * is computed inside the transaction (so a dry run sees the schools it would write) and applied
 * after the commit, only for a real run.
 */
async function sequencePlan(tx: Tx): Promise<{ report: TableReport; wanted: number }> {
  const r = report('custom_school_seq')
  const [used] = (
    await tx.execute(
      sql`select coalesce(max(substr(uai, 4, 4)::int), 0)::int as n from schools where uai ~ '^999[0-9]{4}Z$'`,
    )
  ).rows as Array<{ n: number }>
  const [seq] = (
    await tx.execute(sql`select last_value::int as last, is_called from custom_school_seq`)
  ).rows as Array<{ last: number; is_called: boolean }>
  const current = seq?.is_called ? (seq.last ?? 0) : 0
  const wanted = used?.n ?? 0
  r.read = wanted
  if (wanted > current) r.problems.push(`custom_school_seq would move from ${current} to ${wanted}`)
  return { report: r, wanted: wanted > current ? wanted : 0 }
}

// --- Directory, sources, trust, settings ----------------------------------------------------

async function schools(src: SourceDb, tx: Tx): Promise<TableReport> {
  const r = report('schools')
  const rows = await src.query<Row>(
    `select uai, name, city, postcode, department, academy, kind, level,
            st_x(location::geometry) as lng, st_y(location::geometry) as lat
     from schools`,
  )
  r.read = rows.length
  for (const batch of chunks(rows)) {
    const out = await tx.execute(sql`
      insert into schools (uai, name, city, postcode, department, academy, kind, level, location)
      values ${sql.join(
        batch.map(
          (s) =>
            sql`(${s.uai}, ${s.name}, ${s.city}, ${str(s.postcode)}, ${str(s.department)}, ${str(s.academy)}, ${str(s.kind)},
                 ${LEVEL[String(s.level)] === 'higher' ? 'higher' : 'secondary'}::school_level,
                 ${s.lng == null ? sql`null` : sql`st_setsrid(st_makepoint(${num(s.lng)}, ${num(s.lat)}), 4326)::geography`})`,
        ),
        sql`, `,
      )}
      on conflict (uai) do update set name = excluded.name, city = excluded.city, postcode = excluded.postcode,
        department = excluded.department, academy = excluded.academy, kind = excluded.kind,
        level = excluded.level, location = excluded.location, updated_at = now()
      returning (xmax = 0) as fresh`)
    tally(r, out.rows as Array<{ fresh: boolean }>)
  }
  return r
}

async function sources(src: SourceDb, tx: Tx, ids: Set<string>): Promise<TableReport> {
  const r = report('sources')
  const rows = await src.query<Row>(`select * from scrape_sources`)
  r.read = rows.length
  for (const s of rows) {
    const origin = ORIGIN[String(s.source_type)]
    if (!origin || origin === 'on_site') {
      r.skipped++
      r.problems.push(`source ${String(s.id)}: unknown type ${String(s.source_type)}`)
      continue
    }
    const out = await rowAttempt(tx, r, `source ${String(s.id)}`, (sp) =>
      sp
        .insert(schema.sources)
        .values({
          id: String(s.id),
          kind: s.kind as 'telegram',
          identifier: String(s.identifier),
          label: String(s.label),
          origin,
          trusted: Boolean(s.trusted),
          enabled: Boolean(s.enabled),
          reportsHidden: Boolean(s.reports_hidden),
          lastRunAt: date(s.last_run_at),
          lastError: str(s.last_error),
          createdAt: date(s.created_at) ?? new Date(),
        })
        .onConflictDoUpdate({
          target: schema.sources.id,
          set: {
            label: sql`excluded.label`,
            origin: sql`excluded.origin`,
            trusted: sql`excluded.trusted`,
            enabled: sql`excluded.enabled`,
            reportsHidden: sql`excluded.reports_hidden`,
          },
        })
        .returning({ fresh: sql<boolean>`(xmax = 0)` }),
    )
    if (!out) continue
    ids.add(String(s.id))
    tally(r, out)
  }
  return r
}

async function trustedDomains(src: SourceDb, tx: Tx): Promise<TableReport> {
  const r = report('trusted_domains')
  const rows = await src.query<Row>(`select domain, label, kind from trusted_domains`)
  r.read = rows.length
  for (const d of rows) {
    const origin = ORIGIN[String(d.kind)]
    if (origin !== 'press' && origin !== 'union') {
      r.skipped++
      continue
    }
    const out = await tx
      .insert(schema.trustedDomains)
      .values({ domain: String(d.domain), label: String(d.label), origin })
      .onConflictDoUpdate({
        target: schema.trustedDomains.domain,
        set: { label: sql`excluded.label`, origin: sql`excluded.origin` },
      })
      .returning({ fresh: sql<boolean>`(xmax = 0)` })
    tally(r, out)
  }
  return r
}

/** Legacy settings are text ("on", "5"): typed and validated against the schema of each setting. */
export function parseLegacySetting(key: string, value: string): unknown {
  if (key === 'judge_tiers') return value === 'on'
  if (key === 'movement_start') return value
  return Number(value)
}

async function settingsTable(src: SourceDb, tx: Tx, tables: TableReport[]): Promise<Settings> {
  const r = report('settings')
  const rows = await src.query<Row>(`select key, value from app_settings`)
  r.read = rows.length
  for (const s of rows) {
    const key = String(s.key)
    const value = parseLegacySetting(key, String(s.value))
    if (!isSettingKey(key) || !isValidSetting(key, value)) {
      r.skipped++
      r.problems.push(`setting ${key}=${String(s.value)} is not valid in v2: left to its default`)
      continue
    }
    const out = await tx
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: sql`excluded.value`, updatedAt: sql`now()` },
      })
      .returning({ fresh: sql<boolean>`(xmax = 0)` })
    tally(r, out)
  }
  tables.push(r)
  return readSettings(await tx.select().from(schema.settings))
}

// --- Reports -----------------------------------------------------------------------------------

async function reports(src: SourceDb, tx: Tx, settings: Settings): Promise<TableReport> {
  const r = report('reports (with judgements and submissions)')
  const rows = await src.query<Row>(
    `select r.*, s.level as school_level, rs.lat as sub_lat, rs.lng as sub_lng, rs.distance_m as sub_distance
     from reports r
     join schools s on s.uai = r.school_uai
     left join report_submissions rs on rs.report_id = r.id`,
  )
  r.read = rows.length
  const sourceIds = new Set(
    (await tx.select({ id: schema.sources.id }).from(schema.sources)).map((s) => s.id),
  )
  for (const batch of chunks(rows)) {
    for (const x of batch) {
      const origin = ORIGIN[String(x.source_type)]
      const status = STATUS[String(x.status)]
      const moderation = MODERATION[String(x.moderation)]
      if (!origin || !status || !moderation) {
        r.skipped++
        r.problems.push(
          `report ${String(x.id)}: unknown value (${String(x.source_type)}/${String(x.status)}/${String(x.moderation)})`,
        )
        continue
      }
      const probability = x.judge_score == null ? null : Number(x.judge_score)
      const nature = x.judge_nature ? (NATURE[String(x.judge_nature)] ?? null) : null
      const judgeLevel = x.judge_level ? (LEVEL[String(x.judge_level)] ?? null) : null
      const schoolLevel = LEVEL[String(x.school_level)] === 'higher' ? 'higher' : 'secondary'
      const tier = tierOf(
        {
          probability,
          nature,
          status,
          onSite: origin === 'on_site',
          levelConflict:
            judgeLevel != null && judgeLevel !== 'unknown' && judgeLevel !== schoolLevel,
        },
        { keep: settings.judge_keep, low: settings.judge_low },
      )
      const dateBasis = DATE_BASIS.has(String(x.date_basis))
        ? (String(x.date_basis) as 'extracted')
        : null
      const sourceId =
        x.source_id && sourceIds.has(String(x.source_id)) ? String(x.source_id) : null
      const values = {
        id: String(x.id),
        schoolUai: String(x.school_uai),
        status,
        origin,
        sourceId,
        sourceUrl: str(x.source_url),
        sourceDomain: str(x.source_domain),
        moderation,
        certainty: x.certainty ? (CERTAINTY[String(x.certainty)] ?? null) : null,
        observedAt: date(x.observed_at) ?? new Date(),
        publishedAt: date(x.published_at),
        extractedObservedAt: str(x.extracted_observed_at),
        dateBasis,
        tier,
        hidden: Boolean(x.hidden),
        photoKey: str(x.photo_public_path),
        moderatedAt: moderation === 'pending' ? null : (date(x.created_at) ?? new Date()),
        createdAt: date(x.created_at) ?? new Date(),
      }
      const written = await rowAttempt(tx, r, `report ${String(x.id)}`, async (sp) => {
        const out = await sp
          .insert(schema.reports)
          .values(values)
          .onConflictDoUpdate({
            target: schema.reports.id,
            set: {
              schoolUai: sql`excluded.school_uai`,
              status: sql`excluded.status`,
              moderation: sql`excluded.moderation`,
              hidden: sql`excluded.hidden`,
              tier: sql`excluded.tier`,
              observedAt: sql`excluded.observed_at`,
              photoKey: sql`excluded.photo_key`,
            },
          })
          .returning({ fresh: sql<boolean>`(xmax = 0)` })
        if (probability !== null)
          await sp
            .insert(schema.judgements)
            .values({
              reportId: values.id,
              provider: 'jev',
              model: str(x.judge_model) ?? 'jev',
              probability,
              nature,
              level: judgeLevel,
              chars: x.judge_chars == null ? null : Number(x.judge_chars),
              judgedAt: date(x.judged_at) ?? new Date(),
            })
            .onConflictDoUpdate({
              target: schema.judgements.reportId,
              set: {
                probability: sql`excluded.probability`,
                nature: sql`excluded.nature`,
                level: sql`excluded.level`,
              },
            })
        if (x.sub_lat != null)
          await sp
            .insert(schema.reportSubmissions)
            .values({
              reportId: values.id,
              lat: Number(x.sub_lat),
              lng: Number(x.sub_lng),
              distanceM: Number(x.sub_distance ?? 0),
            })
            .onConflictDoNothing()
        return out
      })
      if (written) tally(r, written)
    }
  }
  return r
}

// --- Staff queues ---------------------------------------------------------------------------------

async function unmatched(src: SourceDb, tx: Tx): Promise<TableReport> {
  const r = report('unmatched')
  const rows = await src.query<Row>(`select * from unmatched_extractions`)
  r.read = rows.length
  const sourceIds = new Set(
    (await tx.select({ id: schema.sources.id }).from(schema.sources)).map((s) => s.id),
  )
  for (const u of rows) {
    const status = STATUS[String(u.status)]
    if (!status) {
      r.skipped++
      continue
    }
    const out = await tx
      .insert(schema.unmatched)
      .values({
        id: String(u.id),
        sourceId: u.source_id && sourceIds.has(String(u.source_id)) ? String(u.source_id) : null,
        sourceDomain: str(u.source_domain),
        context: str(u.context),
        schoolName: String(u.school_name),
        city: str(u.city),
        status,
        sourceUrl: String(u.source_url),
        observedAt: date(u.observed_at) ?? new Date(),
        createdAt: date(u.created_at) ?? new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: schema.unmatched.id })
    if (out.length) r.inserted++
    else r.updated++
  }
  return r
}

async function proposals(src: SourceDb, tx: Tx): Promise<TableReport> {
  const r = report('school_proposals')
  const rows = await src.query<Row>(`select * from school_proposals`)
  r.read = rows.length
  for (const p of rows) {
    const status = STATUS[String(p.status)]
    if (!status) {
      r.skipped++
      continue
    }
    const out = await tx
      .insert(schema.schoolProposals)
      .values({
        id: String(p.id),
        name: String(p.name),
        city: String(p.city),
        status,
        lat: Number(p.lat),
        lng: Number(p.lng),
        sourceUrl: str(p.source_url),
        createdAt: date(p.created_at) ?? new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: schema.schoolProposals.id })
    if (out.length) r.inserted++
    else r.updated++
  }
  return r
}

/**
 * What the collector had already seen, as finished items: after the cutover the pipeline does
 * not read and analyse again the last days of every feed. The URL is a placeholder, the item is
 * never read again.
 */
async function seenItems(src: SourceDb, tx: Tx, days: number): Promise<TableReport> {
  const r = report('scraped_items → ingest_items')
  const rows = await src.query<Row>(
    `select source_id, external_id, processed_at from scraped_items
     where processed_at >= now() - make_interval(days => $1)`,
    [days],
  )
  r.read = rows.length
  const sourceIds = new Set(
    (await tx.select({ id: schema.sources.id }).from(schema.sources)).map((s) => s.id),
  )
  const usable = rows.filter((x) => sourceIds.has(String(x.source_id)))
  r.skipped = rows.length - usable.length
  for (const batch of chunks(usable)) {
    const out = await tx
      .insert(schema.ingestItems)
      .values(
        batch.map((x) => ({
          sourceId: String(x.source_id),
          externalId: String(x.external_id),
          url: `https://legacy.invalid/${createHash('sha1').update(String(x.external_id)).digest('hex')}`,
          publishedAt: date(x.processed_at) ?? new Date(),
          // Seen by the old collector then, not discovered by this pipeline today (keeps the admin funnel honest).
          discoveredAt: date(x.processed_at) ?? new Date(),
          state: 'done' as const,
          reason: 'migrated from the previous collector',
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.ingestItems.id })
    r.inserted += out.length
    r.updated += batch.length - out.length
  }
  return r
}

// --- Analysis, usage, statistics, audit ------------------------------------------------------------------

async function media(src: SourceDb, tx: Tx): Promise<TableReport> {
  const r = report('media_analyses')
  const rows = await src.query<Row>(`select * from media_analyses`)
  r.read = rows.length
  const sourceIds = new Set(
    (await tx.select({ id: schema.sources.id }).from(schema.sources)).map((s) => s.id),
  )
  for (const batch of chunks(rows)) {
    const values = batch.flatMap((m) => {
      const focus = MEDIA_FOCUS[String(m.focus)]
      const tone = MEDIA_TONE[String(m.tone)]
      if (!focus || !tone) {
        r.skipped++
        return []
      }
      return [
        {
          id: String(m.id),
          url: String(m.url),
          domain: String(m.domain),
          title: str(m.title),
          sourceId: m.source_id && sourceIds.has(String(m.source_id)) ? String(m.source_id) : null,
          publishedAt: date(m.published_at),
          aboutMovement: Boolean(m.about_movement),
          mentionsDemands: Boolean(m.mentions_demands),
          demands: (m.demands as string[] | null) ?? [],
          voices: ((m.voices as string[] | null) ?? []).map((v) => MEDIA_VOICE[v] ?? v),
          focus,
          incidents: Boolean(m.incidents),
          policeViolence: Boolean(m.police_violence),
          terms: (m.terms as string[] | null) ?? [],
          tone,
          quoteDemands: str(m.quote_demands),
          quoteFraming: str(m.quote_framing),
          model: str(m.model),
          promptVersion: 'v1',
          textChars: m.text_chars == null ? null : Number(m.text_chars),
          analyzedAt: date(m.analyzed_at) ?? new Date(),
        },
      ]
    })
    if (values.length === 0) continue
    const out = await tx
      .insert(schema.mediaAnalyses)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: schema.mediaAnalyses.id })
    r.inserted += out.length
    r.updated += values.length - out.length
  }
  return r
}

async function aiUsage(src: SourceDb, tx: Tx): Promise<TableReport> {
  const r = report('ai_usage')
  const rows = await src.query<Row>(`select * from ai_usage`)
  r.read = rows.length
  for (const batch of chunks(rows)) {
    const values = batch.flatMap((u) => {
      const task = AI_TASK[String(u.task)]
      if (!task) {
        r.skipped++
        return []
      }
      const usage = {
        calls: num(u.calls),
        promptTokens: num(u.prompt_tokens),
        outputTokens: num(u.output_tokens),
        thoughtsTokens: num(u.thoughts_tokens),
      }
      return [
        {
          hour: date(u.bucket) ?? new Date(),
          task,
          provider: task === 'judge' ? 'jev' : 'gemini',
          model: String(u.model),
          promptVersion: 'v1',
          calls: usage.calls,
          failures: 0,
          promptTokens: usage.promptTokens,
          outputTokens: usage.outputTokens,
          thoughtsTokens: usage.thoughtsTokens,
          costUsd: costOf(DEFAULT_PRICES, String(u.model), usage).toFixed(6),
          latencyMsTotal: 0,
        },
      ]
    })
    if (values.length === 0) continue
    const out = await tx
      .insert(schema.aiUsage)
      .values(values)
      .onConflictDoNothing()
      .returning({ calls: schema.aiUsage.calls })
    r.inserted += out.length
    r.updated += values.length - out.length
  }
  return r
}

async function analytics(src: SourceDb, tx: Tx): Promise<TableReport[]> {
  const daily = report('analytics_daily')
  const days = await src.query<Row>(`select day, visitors from analytics_daily`)
  daily.read = days.length
  for (const d of days) {
    const out = await tx
      .insert(schema.analyticsDaily)
      .values({ day: String(date(d.day)?.toISOString().slice(0, 10)), visitors: num(d.visitors) })
      .onConflictDoUpdate({
        target: schema.analyticsDaily.day,
        set: { visitors: sql`excluded.visitors` },
      })
      .returning({ fresh: sql<boolean>`(xmax = 0)` })
    tally(daily, out)
  }

  const views = report('analytics_page_views')
  const hours = await src.query<Row>(`select hour, page, views from analytics_pageviews`)
  views.read = hours.length
  for (const batch of chunks(hours)) {
    const values = batch.map((h) => ({
      slot: date(h.hour) ?? new Date(),
      page: PAGE[String(h.page)] ?? 'other',
      views: num(h.views),
    }))
    const out = await tx
      .insert(schema.analyticsPageViews)
      .values(values)
      .onConflictDoNothing()
      .returning({ views: schema.analyticsPageViews.views })
    views.inserted += out.length
    views.updated += values.length - out.length
  }

  const vitals = report('analytics_vitals')
  const samples = await src.query<Row>(
    `select at, page, metric, value from analytics_vitals where at >= now() - interval '30 days'`,
  )
  vitals.read = samples.length
  // Samples have no identity: carried once, only into an empty window, so a second run adds nothing.
  const [existing] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.analyticsVitals)
  if ((existing?.n ?? 0) === 0)
    for (const batch of chunks(samples)) {
      await tx.insert(schema.analyticsVitals).values(
        batch.map((v) => ({
          at: date(v.at) ?? new Date(),
          page: PAGE[String(v.page)] ?? 'other',
          metric: String(v.metric) as 'LCP',
          value: Number(v.value),
        })),
      )
      vitals.inserted += batch.length
    }
  else vitals.skipped = samples.length
  return [daily, views, vitals]
}

async function audit(src: SourceDb, tx: Tx): Promise<TableReport> {
  const r = report('moderation_audit')
  const rows = await src.query<Row>(
    `select at, actor_email, action, target, before, after from moderation_audit order by id`,
  )
  r.read = rows.length
  // The legacy lines are prefixed so a second run can tell them from the v2 ones and skip them.
  const [done] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.moderationAudit)
    .where(sql`${schema.moderationAudit.action} like 'legacy:%'`)
  if ((done?.n ?? 0) > 0) {
    r.skipped = rows.length
    return r
  }
  for (const batch of chunks(rows)) {
    await tx.insert(schema.moderationAudit).values(
      batch.map((a) => ({
        at: date(a.at) ?? new Date(),
        actorEmail: str(a.actor_email),
        action: `legacy:${String(a.action)}`,
        target: str(a.target),
        before: a.before ?? null,
        after: a.after ?? null,
      })),
    )
    r.inserted += batch.length
  }
  return r
}

// --- Photos ----------------------------------------------------------------------------------------

/** Copies the published (blurred) photos from the legacy public bucket into the blob store. */
async function photos(
  src: SourceDb,
  options: NonNullable<MigrationOptions['photos']>,
  dryRun: boolean,
): Promise<TableReport> {
  const r = report('published photos')
  const rows = await src.query<Row>(
    `select photo_public_path from reports where photo_public_path is not null and moderation = 'validated'`,
  )
  r.read = rows.length
  const fetchFn = options.fetchFn ?? fetch
  for (const row of rows) {
    const name = String(row.photo_public_path)
    const key = `public/${name}`
    if (!/^[0-9a-f-]{36}\.(jpg|webp)$/.test(name)) {
      r.skipped++
      r.problems.push(`photo ${name}: unexpected name`)
      continue
    }
    if ((await options.blobs.get(key)) !== null) {
      r.updated++
      continue
    }
    if (dryRun) {
      r.inserted++
      continue
    }
    try {
      const res = await fetchFn(`${options.publicBaseUrl.replace(/\/$/, '')}/${name}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await options.blobs.put(key, new Uint8Array(await res.arrayBuffer()))
      r.inserted++
    } catch (e) {
      r.skipped++
      r.problems.push(`photo ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return r
}
