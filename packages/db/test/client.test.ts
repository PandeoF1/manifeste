import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createDb } from '../src/client.ts'
import { testServerUrl } from '../src/testing.ts'

describe('database pool', () => {
  test('an error on an idle connection is reported, not an uncaught exception', async () => {
    const errors: string[] = []
    const handle = createDb(testServerUrl(), { onPoolError: (e) => errors.push(e.message) })
    try {
      // pg emits this when the database restarts or the network drops. With no listener on the
      // pool, `emit('error')` throws: that is what would stop the process.
      expect(() => handle.pool.emit('error', new Error('terminating connection'))).not.toThrow()
      expect(errors).toEqual(['terminating connection'])
    } finally {
      await handle.close()
    }
  })

  test('a statement longer than the configured limit is cancelled', async () => {
    const handle = createDb(testServerUrl(), { statementTimeoutMs: 200 })
    try {
      const started = Date.now()
      // (`execute` returns a thenable, not a promise: wrap it for `rejects`)
      await expect((async () => handle.db.execute(sql`select pg_sleep(5)`))()).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(3000)
    } finally {
      await handle.close()
    }
  })

  test('without a limit nothing is changed (migrations build indexes for a long time)', async () => {
    const handle = createDb(testServerUrl())
    try {
      const { rows } = await handle.db.execute(sql`show statement_timeout`)
      expect(rows[0]).toEqual({ statement_timeout: '0' })
    } finally {
      await handle.close()
    }
  })
})
