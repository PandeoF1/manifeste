import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { migrationStatus } from '../src/migrate.ts'
import { createTestDb } from '../src/testing.ts'

const t = await createTestDb()
afterAll(() => t.drop())

describe('migrations', () => {
  test('are all applied on a fresh database', async () => {
    const status = await migrationStatus(t.db)
    expect(status.expected).toBeGreaterThan(0)
    expect(status.upToDate).toBe(true)
  })

  test('enable PostGIS, pg_trgm and unaccent', async () => {
    const { rows } = await t.db.execute<{ extname: string }>(
      sql`select extname from pg_extension order by extname`,
    )
    expect(rows.map((r) => r.extname)).toEqual(
      expect.arrayContaining(['pg_trgm', 'postgis', 'unaccent']),
    )
  })
})
