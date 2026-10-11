/** `bun run --filter @manifeste/db migrate`: applies pending migrations to DATABASE_URL. */
import { createDb } from '../client.ts'
import { migrationStatus, runMigrations } from '../migrate.ts'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}
const { db, close } = createDb(url, { max: 1, applicationName: 'manifeste-migrate' })
try {
  await runMigrations(db)
  const status = await migrationStatus(db)
  console.log(`migrations: ${status.applied}/${status.expected} applied`)
} finally {
  await close()
}
