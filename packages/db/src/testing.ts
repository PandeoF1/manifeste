/**
 * Integration test helpers: one migrated template database, cloned for every test file.
 * Cloning a template takes a few milliseconds, so each file gets an isolated, fully migrated DB.
 *
 *   const t = await createTestDb()
 *   afterAll(() => t.drop())
 *
 * TEST_DATABASE_URL points at a server where the user may create databases
 * (default: the local dev server on port 54329, see docs/development.md).
 */
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { createDb, type DbHandle } from './client.ts'
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts'

const TEMPLATE = 'manifeste_template'

export const testServerUrl = (): string =>
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres'

function withDatabase(url: string, name: string): string {
  const u = new URL(url)
  u.pathname = `/${name}`
  return u.toString()
}

/** Hash of every migration file: the template is rebuilt when a migration changes. */
function migrationsHash(): string {
  const hash = createHash('sha256')
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else hash.update(entry.name).update(readFileSync(path))
    }
  }
  walk(MIGRATIONS_FOLDER)
  return hash.digest('hex').slice(0, 16)
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: testServerUrl() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

let templateReady: Promise<void> | null = null

/** Builds (or reuses) the migrated template database. */
export function ensureTemplate(): Promise<void> {
  templateReady ??= admin(async (client) => {
    const hash = migrationsHash()
    // Serialise template builds across parallel test processes.
    await client.query('select pg_advisory_lock(424242)')
    try {
      const { rows } = await client.query<{ comment: string | null }>(
        `select shobj_description(oid, 'pg_database') as comment from pg_database where datname = $1`,
        [TEMPLATE],
      )
      if (rows[0]?.comment === hash) return
      if (rows.length) await client.query(`drop database ${TEMPLATE} with (force)`)
      await client.query(`create database ${TEMPLATE}`)
      const handle = createDb(withDatabase(testServerUrl(), TEMPLATE), { max: 1 })
      try {
        await runMigrations(handle.db)
      } finally {
        await handle.close()
      }
      await client.query(`comment on database ${TEMPLATE} is '${hash}'`)
    } finally {
      await client.query('select pg_advisory_unlock(424242)')
    }
  })
  return templateReady
}

export interface TestDb extends DbHandle {
  url: string
  name: string
  drop(): Promise<void>
}

/** A fresh migrated database for one test file. */
export async function createTestDb(): Promise<TestDb> {
  await ensureTemplate()
  const name = `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  await admin((client) => client.query(`create database ${name} template ${TEMPLATE}`))
  const url = withDatabase(testServerUrl(), name)
  const handle = createDb(url, { max: 5, applicationName: 'manifeste-test' })
  return {
    ...handle,
    url,
    name,
    async drop() {
      await handle.close()
      await admin((client) => client.query(`drop database if exists ${name} with (force)`))
    },
  }
}
