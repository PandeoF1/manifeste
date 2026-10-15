/** Test data builders: insert schools and reports straight into a test database. */
import { sql } from 'drizzle-orm'
import { schema, type Database } from '@manifeste/db'
import type { ReportOrigin, ReportStatus, SchoolLevel, Tier } from '@manifeste/core'

let counter = 0
const nextUai = () => `${String(++counter).padStart(7, '0')}A`

export interface SchoolSeed {
  uai?: string
  name?: string
  city?: string
  department?: string
  academy?: string
  level?: SchoolLevel
  lat?: number
  lng?: number
  aliases?: string[]
}

export async function addSchool(db: Database, s: SchoolSeed = {}) {
  const uai = s.uai ?? nextUai()
  const lat = s.lat ?? 48.85
  const lng = s.lng ?? 2.35
  await db.insert(schema.schools).values({
    uai,
    name: s.name ?? `Lycée Test ${uai}`,
    city: s.city ?? 'Paris',
    department: s.department ?? '75',
    academy: s.academy ?? 'Paris',
    level: s.level ?? 'secondary',
    aliases: s.aliases ?? [],
    location: sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`,
  })
  return uai
}

export interface ReportSeed {
  schoolUai: string
  status?: ReportStatus
  origin?: ReportOrigin
  /** Hours before now (negative = in the future). */
  hoursAgo?: number
  moderation?: 'pending' | 'approved' | 'rejected'
  hidden?: boolean
  tier?: Tier
  sourceId?: string | null
  sourceDomain?: string | null
}

export async function addReport(db: Database, r: ReportSeed) {
  const origin = r.origin ?? 'press'
  const sourceDomain = origin === 'on_site' ? null : (r.sourceDomain ?? 'example.org')
  const observedAt = new Date(Date.now() - (r.hoursAgo ?? 0) * 3_600_000)
  const [row] = await db
    .insert(schema.reports)
    .values({
      schoolUai: r.schoolUai,
      status: r.status ?? 'blocked',
      origin,
      moderation: r.moderation ?? 'approved',
      hidden: r.hidden ?? false,
      tier: r.tier ?? 'unjudged',
      sourceId: r.sourceId ?? null,
      sourceDomain,
      sourceUrl: origin === 'on_site' ? null : `https://${sourceDomain}/article-${++counter}`,
      observedAt,
      publishedAt: observedAt,
    })
    .returning({ id: schema.reports.id })
  if (!row) throw new Error('report not inserted')
  return row.id
}

export const setSetting = (db: Database, key: string, value: unknown) =>
  db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
