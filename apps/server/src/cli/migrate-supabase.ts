/**
 * Copies the production Supabase data into the v2 database. A dry run unless --run is given: it does
 * all the work in a transaction it then rolls back, so what it prints is what a real run would do.
 *
 *   SUPABASE_DB_URL=postgres://… DATABASE_URL=postgres://… \
 *     bun src/cli/migrate-supabase.ts [--run] [--seen-days 7] [--photos <public bucket URL>]
 *
 * Safe to repeat (rehearsal, shadow run, cutover delta). SUPABASE_DB_URL should be a read-only
 * role: this script never writes there. Staff accounts are not carried: re-invite them.
 */
import pg from 'pg'
import { parseArgs } from 'node:util'
import { createDb } from '@manifeste/db'
import { migrateFromSupabase } from '../migration/supabase.ts'
import { FsBlobStore } from '../storage/blob-store.ts'

const { values } = parseArgs({
  options: {
    run: { type: 'boolean', default: false },
    'seen-days': { type: 'string', default: '7' },
    photos: { type: 'string' },
  },
})

const need = (name: string): string => {
  const v = process.env[name]
  if (!v) {
    console.error(`${name} is required`)
    process.exit(1)
  }
  return v
}

const legacy = new pg.Client({
  connectionString: need('SUPABASE_DB_URL'),
  application_name: 'manifeste-migration',
})
await legacy.connect()
// Whatever the role can do, this session cannot write.
await legacy.query('set default_transaction_read_only = on')
const target = createDb(need('DATABASE_URL'), { max: 2, applicationName: 'manifeste-migration' })

try {
  const report = await migrateFromSupabase(
    { query: async (text, params) => (await legacy.query(text, params)).rows },
    target.db,
    {
      dryRun: !values.run,
      seenDays: Number(values['seen-days']),
      ...(values.photos && {
        photos: {
          publicBaseUrl: values.photos,
          blobs: new FsBlobStore(process.env.DATA_DIR ?? './data'),
        },
      }),
    },
  )
  console.table(
    report.tables.map((t) => ({
      table: t.table,
      read: t.read,
      inserted: t.inserted,
      updated: t.updated,
      skipped: t.skipped,
      problems: t.problems.length,
    })),
  )
  for (const t of report.tables)
    for (const p of t.problems.slice(0, 20)) console.warn(`  ${t.table}: ${p}`)
  console.log(report.dryRun ? '\nDry run: nothing was written. Add --run to do it.' : '\nDone.')
} finally {
  await legacy.end()
  await target.close()
}
