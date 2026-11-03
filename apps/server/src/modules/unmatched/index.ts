import { Elysia, t } from 'elysia'
import { REPORT_STATUSES } from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { desc, eq, inArray, isNull } from 'drizzle-orm'
import { status } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { dismissUnmatched, linkUnmatched } from '../../ingest/staff-actions.ts'
import type { IngestService } from '../../ingest/service.ts'
import { audit } from '../../lib/audit.ts'
import { toCsv } from '../../lib/csv.ts'
import type { MatchingService } from '../schools/matching.ts'

const id = t.Object({ id: t.String({ format: 'uuid' }) })
const UAI = '^[0-9]{7}[A-Z]$'
/** Each waiting fact: attach it to a school (`uai`) or drop it (`dismiss`). */
const bulk = t.Object({
  decisions: t.Array(
    t.Union([
      t.Object({ id: t.String({ format: 'uuid' }), uai: t.String({ pattern: UAI }) }),
      t.Object({ id: t.String({ format: 'uuid' }), dismiss: t.Literal(true) }),
    ]),
    { minItems: 1, maxItems: 500 },
  ),
  dryRun: t.Boolean(),
})
const bulkResult = t.Object({
  dryRun: t.Boolean(),
  linked: t.Integer(),
  dismissed: t.Integer(),
  skipped: t.Array(
    t.Object({
      id: t.String(),
      reason: t.UnionEnum(['unknown', 'resolved', 'unknown_school', 'duplicate', 'failed']),
    }),
  ),
})
type BulkResult = typeof bulkResult.static
const CANDIDATES_IN_EXPORT = 3
const row = t.Object({
  id: t.String(),
  schoolName: t.String(),
  city: t.Nullable(t.String()),
  status: t.UnionEnum([...REPORT_STATUSES]),
  sourceUrl: t.String(),
  sourceDomain: t.Nullable(t.String()),
  context: t.Nullable(t.String()),
  observedAt: t.Date(),
  createdAt: t.Date(),
})

/** Facts about a school the directory could not identify: staff link them or dismiss them. */
export const unmatchedModule = (
  auth: Auth,
  db: Database,
  ingest: IngestService,
  matching: MatchingService,
) =>
  new Elysia({ name: 'module.unmatched', prefix: '/api/staff/unmatched' })
    .use(authPlugin(auth))
    .get(
      '/',
      async () =>
        await db
          .select({
            id: schema.unmatched.id,
            schoolName: schema.unmatched.schoolName,
            city: schema.unmatched.city,
            status: schema.unmatched.status,
            sourceUrl: schema.unmatched.sourceUrl,
            sourceDomain: schema.unmatched.sourceDomain,
            context: schema.unmatched.context,
            observedAt: schema.unmatched.observedAt,
            createdAt: schema.unmatched.createdAt,
          })
          .from(schema.unmatched)
          .where(isNull(schema.unmatched.resolvedAt))
          .orderBy(desc(schema.unmatched.createdAt))
          .limit(200),
      {
        staff: { unmatched: ['link'] },
        response: { 200: t.Array(row) },
        detail: { tags: ['staff'], summary: 'Facts waiting for a school' },
      },
    )
    .get(
      '/export',
      async ({ query }) => {
        const waiting = await db
          .select({
            id: schema.unmatched.id,
            schoolName: schema.unmatched.schoolName,
            city: schema.unmatched.city,
            status: schema.unmatched.status,
            sourceUrl: schema.unmatched.sourceUrl,
            sourceDomain: schema.unmatched.sourceDomain,
            context: schema.unmatched.context,
            observedAt: schema.unmatched.observedAt,
          })
          .from(schema.unmatched)
          .where(isNull(schema.unmatched.resolvedAt))
          .orderBy(desc(schema.unmatched.createdAt))
          .limit(query.limit ?? 500)
        // The best schools for each fact, a few at a time (each one is a trigram search).
        const found: Awaited<ReturnType<MatchingService['candidates']>>[] = []
        for (let i = 0; i < waiting.length; i += 8)
          found.push(
            ...(await Promise.all(
              waiting
                .slice(i, i + 8)
                .map((r) => matching.candidates(r.schoolName, r.city, CANDIDATES_IN_EXPORT)),
            )),
          )
        const header = [
          'id',
          'uai',
          'school_cited',
          'city_cited',
          'status',
          'source_url',
          'source_domain',
          'observed_at',
          'extract',
          ...[1, 2, 3].flatMap((n) => [`c${n}_uai`, `c${n}_name`, `c${n}_city`, `c${n}_score`]),
        ]
        const csv = toCsv(
          header,
          waiting.map((r, i) => [
            r.id,
            '',
            r.schoolName,
            r.city,
            r.status,
            r.sourceUrl,
            r.sourceDomain,
            r.observedAt.toISOString(),
            (r.context ?? '').replace(/\s+/g, ' ').slice(0, 400),
            ...Array.from({ length: CANDIDATES_IN_EXPORT }, (_, n) => {
              const c = found[i]?.[n]
              return c ? [c.uai, c.name, c.city, c.score.toFixed(2)] : ['', '', '', '']
            }).flat(),
          ]),
        )
        return new Response(csv, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="non-rattaches-${new Date().toISOString().slice(0, 10)}.csv"`,
            'cache-control': 'private, no-store',
          },
        })
      },
      {
        staff: { unmatched: ['link'] },
        query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })) }),
        detail: {
          tags: ['staff'],
          summary:
            'The waiting facts as CSV, with their best candidate schools and an empty "uai" column to fill',
        },
      },
    )
    .post(
      '/decisions',
      async ({ body, staff }): Promise<BulkResult> => {
        const result: BulkResult = { dryRun: body.dryRun, linked: 0, dismissed: 0, skipped: [] }
        const seen = new Set<string>()
        const wanted = body.decisions.filter((d) => {
          if (!seen.has(d.id)) return seen.add(d.id)
          result.skipped.push({ id: d.id, reason: 'duplicate' })
          return false
        })
        const facts = await db
          .select({ id: schema.unmatched.id, resolvedAt: schema.unmatched.resolvedAt })
          .from(schema.unmatched)
          .where(
            inArray(
              schema.unmatched.id,
              wanted.map((d) => d.id),
            ),
          )
        const uais = [...new Set(wanted.flatMap((d) => ('uai' in d ? [d.uai] : [])))]
        const schools = uais.length
          ? new Set(
              (
                await db
                  .select({ uai: schema.schools.uai })
                  .from(schema.schools)
                  .where(inArray(schema.schools.uai, uais))
              ).map((r) => r.uai),
            )
          : new Set<string>()
        const byId = new Map(facts.map((f) => [f.id, f]))
        for (const d of wanted) {
          const fact = byId.get(d.id)
          if (!fact) result.skipped.push({ id: d.id, reason: 'unknown' })
          else if (fact.resolvedAt) result.skipped.push({ id: d.id, reason: 'resolved' })
          else if ('uai' in d) {
            if (!schools.has(d.uai)) result.skipped.push({ id: d.id, reason: 'unknown_school' })
            else if (body.dryRun) result.linked++
            else {
              const r = await linkUnmatched(ingest.deps, d.id, d.uai, staff.user.id)
              if (!r.ok) result.skipped.push({ id: d.id, reason: 'failed' })
              else {
                result.linked++
                await audit(db, staff, 'unmatched.link', d.id, null, {
                  uai: d.uai,
                  outcome: r.outcome,
                  bulk: true,
                })
              }
            }
          } else if (body.dryRun) result.dismissed++
          else if (await dismissUnmatched(ingest.deps, d.id, staff.user.id)) {
            result.dismissed++
            await audit(db, staff, 'unmatched.dismiss', d.id, null, { bulk: true })
          } else result.skipped.push({ id: d.id, reason: 'resolved' })
        }
        return result
      },
      {
        staff: { unmatched: ['link', 'dismiss'] },
        body: bulk,
        response: { 200: bulkResult },
        detail: {
          tags: ['staff'],
          summary: 'Attach or drop many waiting facts (a filled export); dryRun only previews',
        },
      },
    )
    .get(
      '/:id/candidates',
      async ({ params }) => {
        const [r] = await db
          .select()
          .from(schema.unmatched)
          .where(eq(schema.unmatched.id, params.id))
        if (!r) return status(404, 'Unknown fact')
        return matching.candidates(r.schoolName, r.city, 6)
      },
      {
        staff: { unmatched: ['link'] },
        params: id,
        detail: { tags: ['staff'], summary: 'Likely schools for a waiting fact' },
      },
    )
    .post(
      '/:id/link',
      async ({ params, body, staff }) => {
        const r = await linkUnmatched(ingest.deps, params.id, body.uai, staff.user.id)
        if (!r.ok)
          return status(
            r.reason === 'resolved' ? 409 : r.reason === 'unknown' ? 404 : 422,
            r.reason,
          )
        await audit(db, staff, 'unmatched.link', params.id, null, {
          uai: body.uai,
          outcome: r.outcome,
        })
        return { outcome: r.outcome, reportId: r.reportId }
      },
      {
        staff: { unmatched: ['link'] },
        params: id,
        body: t.Object({ uai: t.String({ pattern: '^[0-9]{7}[A-Z]$' }) }),
        response: {
          200: t.Object({ outcome: t.String(), reportId: t.Nullable(t.String()) }),
          404: t.String(),
          409: t.String(),
          422: t.String(),
        },
        detail: {
          tags: ['staff'],
          summary: 'Attach a waiting fact to a school (it becomes a report)',
        },
      },
    )
    .post(
      '/:id/dismiss',
      async ({ params, staff }) => {
        if (!(await dismissUnmatched(ingest.deps, params.id, staff.user.id)))
          return status(404, 'Unknown or already handled')
        await audit(db, staff, 'unmatched.dismiss', params.id)
        return { ok: true as const }
      },
      {
        staff: { unmatched: ['dismiss'] },
        params: id,
        response: { 200: t.Object({ ok: t.Literal(true) }), 404: t.String() },
        detail: { tags: ['staff'], summary: 'Drop a waiting fact' },
      },
    )
