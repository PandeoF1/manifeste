import { Elysia, t } from 'elysia'
import { REPORT_STATUSES } from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { desc, eq, isNull } from 'drizzle-orm'
import { status } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { dismissUnmatched, linkUnmatched } from '../../ingest/staff-actions.ts'
import type { IngestService } from '../../ingest/service.ts'
import { audit } from '../../lib/audit.ts'
import type { MatchingService } from '../schools/matching.ts'

const id = t.Object({ id: t.String({ format: 'uuid' }) })
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
