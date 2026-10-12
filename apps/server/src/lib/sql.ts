import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@manifeste/db'

/** Runs a raw query and returns its rows (typed by the caller). */
export async function rows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = await db.execute(query)
  return result.rows as T[]
}

/** The common source key of a report: its source, else its domain, else the report itself. */
export const SOURCE_KEY = sql.raw(`
  coalesce(
    case when r.source_id is not null then 'src:' || r.source_id::text
         when r.source_domain is not null then 'dom:' || r.source_domain end,
    'usr:' || r.id::text)`)

/**
 * A user's search text as the literal part of a LIKE / ILIKE pattern: `%` and `_` are wildcards
 * (a search for "%" would match everything and scan the table) and `\` is the escape character.
 */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`)
