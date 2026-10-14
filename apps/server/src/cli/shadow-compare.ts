/**
 * Compares what the previous system and v2 concluded over the last days (the shadow run).
 *
 *   SUPABASE_DB_URL=… DATABASE_URL=… bun src/cli/shadow-compare.ts [--hours 72] [--all-states]
 *
 * Counts reports per school, status and Paris day, and lists the differences. By default only
 * what the public could see counts (approved); --all-states includes the moderation queue.
 */
import pg from 'pg'
import { parseArgs } from 'node:util'
import { createDb } from '@manifeste/db'
import { compareShadow } from '../migration/shadow.ts'

const { values } = parseArgs({
  options: {
    hours: { type: 'string', default: '72' },
    'all-states': { type: 'boolean', default: false },
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
const legacy = new pg.Client({ connectionString: need('SUPABASE_DB_URL') })
await legacy.connect()
await legacy.query('set default_transaction_read_only = on')
const target = createDb(need('DATABASE_URL'), { max: 2, applicationName: 'manifeste-shadow' })
try {
  const since = new Date(Date.now() - Number(values.hours) * 3_600_000)
  const r = await compareShadow(
    { query: async (t, p) => (await legacy.query(t, p)).rows },
    target.db,
    since,
    {
      visibleOnly: !values['all-states'],
    },
  )
  console.log(
    `since ${r.since.toISOString()}: ${r.agree} in both, ${r.onlyLegacy.length} only before, ${r.onlyV2.length} only in v2`,
  )
  const show = (title: string, list: typeof r.onlyLegacy) => {
    if (list.length) console.log(`\n${title}`)
    for (const x of list.slice(0, 60))
      console.log(`  ${x.day} ${x.status.padEnd(9)} ${x.uai} ${x.source ?? ''}`)
  }
  show('Only in the previous system (v2 missed or judged otherwise):', r.onlyLegacy)
  show('Only in v2 (new coverage, or noise):', r.onlyV2)
} finally {
  await legacy.end()
  await target.close()
}
