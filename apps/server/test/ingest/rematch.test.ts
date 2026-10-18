import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { schema } from '@manifeste/db'
import { eq } from 'drizzle-orm'
import { IngestOperations } from '../../src/ingest/operations.ts'
import { IngestService } from '../../src/ingest/service.ts'
import { startTestServer, type TestServer } from '../helpers.ts'
import { addSchool } from '../seed.ts'

let s: TestServer
let ops: IngestOperations
beforeAll(async () => {
  s = await startTestServer()
  await addSchool(s.ctx.db, {
    name: 'Lycée Pasteur',
    city: 'Lille',
    department: '59',
    academy: 'Lille',
    lat: 50.63,
    lng: 3.06,
  })
  ops = new IngestOperations(new IngestService(s.ctx, { fetchFn: async () => new Response('') }))
})
afterAll(() => s.close())

async function orphan(schoolName: string, city: string | null) {
  const [src] = await s.ctx.db
    .insert(schema.sources)
    .values({
      kind: 'rss',
      identifier: `https://${crypto.randomUUID()}.example/feed`,
      label: 'U',
      origin: 'press',
    })
    .returning({ id: schema.sources.id })
  const [row] = await s.ctx.db
    .insert(schema.unmatched)
    .values({
      sourceId: src?.id ?? null,
      sourceDomain: 'u.example',
      schoolName,
      city,
      status: 'blocked',
      sourceUrl: `https://u.example/${crypto.randomUUID()}`,
      observedAt: new Date(),
      context: 'excerpt',
    })
    .returning({ id: schema.unmatched.id })
  return row?.id ?? ''
}

describe('rematch of rows without an extraction', () => {
  test('they are counted, then attached from their own name and city when the match is clear', async () => {
    const clear = await orphan('Lycée Pasteur', 'Lille')
    const vague = await orphan('Lycée Inconnu', null)

    const dry = await ops.run({ kind: 'rematch' }, { dryRun: true })
    expect(dry.summary).toMatchObject({ waiting: 2, withoutExtraction: 2 })

    const run = await ops.run({ kind: 'rematch' }, { dryRun: false })
    expect(run.summary).toMatchObject({ waiting: 2, matched: 1, stillUnmatched: 1 })

    const [done] = await s.ctx.db
      .select()
      .from(schema.unmatched)
      .where(eq(schema.unmatched.id, clear))
    expect(done).toMatchObject({ resolution: 'linked', resolvedBy: null })
    expect(done?.linkedUai).toBeTruthy()
    const [left] = await s.ctx.db
      .select()
      .from(schema.unmatched)
      .where(eq(schema.unmatched.id, vague))
    expect(left?.resolvedAt).toBeNull()
  })

  test('a school abroad is closed as foreign, and a curated alias is attached', async () => {
    await addSchool(s.ctx.db, {
      uai: '0490811R',
      name: "Facultés libres de l'Ouest",
      city: 'Angers',
      department: '49',
      academy: 'Nantes',
      lat: 47.47,
      lng: -0.55,
    })
    const abroad = await orphan('athénée Maurice Destenay', 'Liège')
    const catho = await orphan('Catho d’Angers', 'Angers')

    const run = await ops.run({ kind: 'rematch' }, { dryRun: false })
    expect(run.summary).toMatchObject({ foreign: 1, matched: 1 })

    const [closed] = await s.ctx.db
      .select()
      .from(schema.unmatched)
      .where(eq(schema.unmatched.id, abroad))
    expect(closed).toMatchObject({ resolution: 'foreign', linkedUai: null, resolvedBy: null })
    expect(closed?.resolvedAt).not.toBeNull()
    const [linked] = await s.ctx.db
      .select()
      .from(schema.unmatched)
      .where(eq(schema.unmatched.id, catho))
    expect(linked).toMatchObject({ resolution: 'linked', linkedUai: '0490811R' })
  })
})
