/**
 * The shadow run: for some days v2 reads the same sources as production without publishing
 * anything. This compares what each system concluded, per school, status and day, so the
 * differences can be read and explained before the cutover instead of discovered after it.
 */
import { sql } from 'drizzle-orm'
import type { Database } from '@manifeste/db'
import { rows } from '../lib/sql.ts'
import type { SourceDb } from './supabase.ts'

export interface ShadowReport {
  since: Date
  /** Both systems have it. */
  agree: number
  /** Only the previous system reported it: v2 missed it (or judged it differently). */
  onlyLegacy: Array<{ uai: string; status: string; day: string; source: string | null }>
  /** Only v2 reported it: new coverage, or noise. */
  onlyV2: Array<{ uai: string; status: string; day: string; source: string | null }>
}

const STATUS: Record<string, string> = { bloque: 'blocked', filtrant: 'filtering', leve: 'lifted' }

export async function compareShadow(
  legacy: SourceDb,
  v2: Database,
  since: Date,
  /** Which reports count: only the ones people could see (approved / validated). */
  options: { visibleOnly?: boolean } = {},
): Promise<ShadowReport> {
  const visible = options.visibleOnly ?? true
  const old = await legacy.query<{
    uai: string
    status: string
    day: string
    source: string | null
  }>(
    `select school_uai as uai, status, (observed_at at time zone 'Europe/Paris')::date::text as day, min(source_domain) as source
     from reports where observed_at >= $1 and source_type <> 'utilisateur' ${visible ? "and moderation = 'validated'" : ''}
     group by 1, 2, 3`,
    [since.toISOString()],
  )
  const now = await rows<{ uai: string; status: string; day: string; source: string | null }>(
    v2,
    sql`select school_uai as uai, status::text as status, (observed_at at time zone 'Europe/Paris')::date::text as day, min(source_domain) as source
        from reports where observed_at >= ${since.toISOString()}::timestamptz and origin <> 'on_site'
          ${visible ? sql`and moderation = 'approved'` : sql``}
        group by 1, 2, 3`,
  )
  const key = (r: { uai: string; status: string; day: string }) => `${r.uai}|${r.status}|${r.day}`
  const legacyKeys = new Map(
    old.map((r) => [
      key({ ...r, status: STATUS[r.status] ?? r.status }),
      { ...r, status: STATUS[r.status] ?? r.status },
    ]),
  )
  const v2Keys = new Map(now.map((r) => [key(r), r]))
  return {
    since,
    agree: [...legacyKeys.keys()].filter((k) => v2Keys.has(k)).length,
    onlyLegacy: [...legacyKeys].filter(([k]) => !v2Keys.has(k)).map(([, r]) => r),
    onlyV2: [...v2Keys].filter(([k]) => !legacyKeys.has(k)).map(([, r]) => r),
  }
}
