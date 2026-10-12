import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { sql } from 'drizzle-orm'
import { registerIngestJobs } from '../../src/ingest/jobs.ts'
import { IngestService } from '../../src/ingest/service.ts'
import { startTestServer, type TestServer } from '../helpers.ts'

let s: TestServer
beforeAll(async () => {
  s = await startTestServer()
})
afterAll(() => s.close())

const until = async (check: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
  return check()
}

describe('pipeline jobs', () => {
  test('a wake-up that arrives while a sweep runs is kept for the next sweep, not lost or piled up', async () => {
    const ingest = new IngestService(s.ctx, { fetchFn: async () => new Response('') })
    let runs = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    ingest.read = async () => {
      runs++
      if (runs === 1) await gate
      return { read: 0, merged: 0, unreadable: 0, failed: 0, more: false }
    }
    await registerIngestJobs(s.ctx, ingest)

    await s.ctx.queue.send('ingest.read', {}, { singletonKey: 'read' })
    expect(await until(() => runs === 1)).toBe(true)
    // While the first sweep is running, five more wake-ups arrive.
    for (let i = 0; i < 5; i++) await s.ctx.queue.send('ingest.read', {}, { singletonKey: 'read' })
    release()
    expect(await until(() => runs === 2)).toBe(true)
    await new Promise((r) => setTimeout(r, 4000))
    expect(runs).toBe(2)
  }, 40_000)

  test('the tick reads the sources that are due and nudges every stage', async () => {
    await s.ctx.db.insert(schema.sources).values([
      { kind: 'rss', identifier: 'https://a.example/feed', label: 'A' },
      { kind: 'rss', identifier: 'https://b.example/feed', label: 'B', enabled: false },
    ])
    const ingest = new IngestService(s.ctx, { fetchFn: async () => new Response('') })
    const discovered: string[] = []
    ingest.discover = async (sourceId, trigger) => {
      discovered.push(`${sourceId}:${trigger}`)
      return { runId: '', fetched: 0, newItems: 0, relevant: 0 }
    }
    await registerIngestJobs(s.ctx, ingest)
    await s.ctx.queue.send('ingest.tick', {})
    expect(await until(() => discovered.length === 1)).toBe(true)
    expect(discovered[0]).toEndWith(':schedule')
  }, 40_000)

  test('reports the judge could not look at are judged again on a schedule', async () => {
    const ingest = new IngestService(s.ctx, { fetchFn: async () => new Response('') })
    await registerIngestJobs(s.ctx, ingest)
    const { rows } = await s.ctx.db.execute(
      sql`select name, key, cron, data from pgboss.schedule where name = 'ingest.operation'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'rejudge-unjudged', cron: '*/30 * * * *' })
    expect(rows[0]?.data).toMatchObject({ kind: 'rejudge', sinceHours: 48 })
  })
})
