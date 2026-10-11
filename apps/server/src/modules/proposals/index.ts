/**
 * Schools proposed by visitors because theirs was missing from the directory. Staff attach the
 * proposal to an existing school, or create the school; the report then goes to moderation.
 */
import { Elysia, t } from 'elysia'
import { REPORT_STATUSES, tierOf } from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { desc, eq, sql } from 'drizzle-orm'
import { status } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { audit } from '../../lib/audit.ts'
import { rows } from '../../lib/sql.ts'
import type { EventBus } from '../../realtime/bus.ts'
import type { BlobStore } from '../../storage/blob-store.ts'
import type { MatchingService } from '../schools/matching.ts'
import { bytesResponse } from '../../lib/response.ts'

const id = t.Object({ id: t.String({ format: 'uuid' }) })
const candidate = t.Object({
  uai: t.String(),
  name: t.String(),
  city: t.String(),
  distanceM: t.Nullable(t.Integer()),
})
const proposal = t.Object({
  id: t.String(),
  name: t.String(),
  city: t.String(),
  status: t.UnionEnum([...REPORT_STATUSES]),
  lat: t.Number(),
  lng: t.Number(),
  hasPhoto: t.Boolean(),
  sourceUrl: t.Nullable(t.String()),
  createdAt: t.Date(),
  candidates: t.Array(candidate),
})

export const proposalsModule = (
  auth: Auth,
  db: Database,
  blobs: BlobStore,
  matching: MatchingService,
  bus: EventBus | null,
) =>
  new Elysia({ name: 'module.proposals', prefix: '/api/staff/proposals' })
    .use(authPlugin(auth))
    .get(
      '/',
      async () => {
        const list = await db
          .select()
          .from(schema.schoolProposals)
          .orderBy(desc(schema.schoolProposals.createdAt))
        return Promise.all(
          list.map(async (p) => {
            const byName = await matching.candidates(p.name, p.city, 3)
            const near = await matching.nearbyForGeo(p.lat, p.lng, 3000)
            const merged = new Map<
              string,
              { uai: string; name: string; city: string; distanceM: number | null }
            >()
            for (const n of near)
              merged.set(n.uai, { uai: n.uai, name: n.name, city: '', distanceM: n.distanceM })
            for (const c of byName)
              merged.set(c.uai, {
                uai: c.uai,
                name: c.name,
                city: c.city,
                distanceM: merged.get(c.uai)?.distanceM ?? null,
              })
            return {
              id: p.id,
              name: p.name,
              city: p.city,
              status: p.status,
              lat: p.lat,
              lng: p.lng,
              hasPhoto: p.photoKey !== null,
              sourceUrl: p.sourceUrl,
              createdAt: p.createdAt,
              candidates: [...merged.values()].slice(0, 6),
            }
          }),
        )
      },
      {
        staff: { unmatched: ['link'] },
        response: { 200: t.Array(proposal) },
        detail: {
          tags: ['staff'],
          summary: 'Proposed schools with the existing ones that could match',
        },
      },
    )
    .get(
      '/:id/photo',
      async ({ params }) => {
        const [p] = await db
          .select({ key: schema.schoolProposals.photoKey })
          .from(schema.schoolProposals)
          .where(eq(schema.schoolProposals.id, params.id))
        const bytes = p?.key ? await blobs.get(p.key) : null
        if (!bytes) return status(404, 'No photo')
        return bytesResponse(bytes, {
          'content-type': 'image/jpeg',
          'cache-control': 'private, no-store',
        })
      },
      {
        staff: { unmatched: ['link'] },
        params: id,
        response: { 404: t.String() },
        detail: { tags: ['staff'], summary: 'The photo of a proposal (never cached)' },
      },
    )
    .post(
      '/:id/resolve',
      async ({ params, body, staff }) => {
        const result = await db.transaction(async (tx) => {
          const [p] = await tx
            .select()
            .from(schema.schoolProposals)
            .where(eq(schema.schoolProposals.id, params.id))
            .for('update')
          if (!p) return { error: 'unknown' as const }
          const point = sql`st_setsrid(st_makepoint(${p.lng}, ${p.lat}), 4326)::geography`
          let uai: string
          if (body.linkUai) {
            const [s] = await tx
              .select({ uai: schema.schools.uai })
              .from(schema.schools)
              .where(eq(schema.schools.uai, body.linkUai))
            if (!s) return { error: 'unknown-school' as const }
            uai = s.uai
          } else {
            if (body.newUai) {
              const [clash] = await tx
                .select({ uai: schema.schools.uai })
                .from(schema.schools)
                .where(eq(schema.schools.uai, body.newUai))
              if (clash) return { error: 'uai-exists' as const }
              uai = body.newUai
            } else {
              const [seq] = await rows<{ n: string }>(
                tx as unknown as Database,
                sql`select nextval('custom_school_seq')::text as n`,
              )
              uai = `999${String(seq?.n ?? '0').padStart(4, '0')}Z`
            }
            // Department and academy: those of the closest school of the directory.
            const [near] = await rows<{ department: string | null; academy: string | null }>(
              tx as unknown as Database,
              sql`select department, academy from schools where location is not null order by location <-> ${point} limit 1`,
            )
            await tx.insert(schema.schools).values({
              uai,
              name: (body.name?.trim() || p.name).slice(0, 120),
              city: (body.city?.trim() || p.city).slice(0, 80),
              department: near?.department ?? null,
              academy: near?.academy ?? null,
              kind: 'added',
              level: 'secondary',
              location: sql`${point}`,
            })
          }
          const domain = p.sourceUrl
            ? new URL(p.sourceUrl).hostname.replace(/^(www|m|amp|mobile)\./, '')
            : null
          const [report] = await tx
            .insert(schema.reports)
            .values({
              schoolUai: uai,
              status: p.status,
              origin: 'on_site',
              sourceUrl: p.sourceUrl,
              sourceDomain: domain,
              moderation: 'pending',
              tier: tierOf({ probability: null, nature: null, status: p.status, onSite: true }),
              observedAt: p.createdAt,
            })
            .returning({ id: schema.reports.id })
          const [dist] = await rows<{ d: number | null }>(
            tx as unknown as Database,
            sql`select round(st_distance(location, ${point}))::int as d from schools where uai = ${uai}`,
          )
          await tx.insert(schema.reportSubmissions).values({
            reportId: report?.id ?? '',
            lat: p.lat,
            lng: p.lng,
            distanceM: dist?.d ?? 0,
            photoKey: p.photoKey,
          })
          await tx.delete(schema.schoolProposals).where(eq(schema.schoolProposals.id, p.id))
          return { uai, reportId: report?.id ?? '' }
        })
        if ('error' in result)
          return status(
            result.error === 'unknown' ? 404 : result.error === 'uai-exists' ? 409 : 422,
            result.error,
          )
        await audit(db, staff, 'proposal.resolve', params.id, null, { ...body, uai: result.uai })
        void bus?.publish({ topic: 'moderation', data: { uai: result.uai } }).catch(() => {})
        return result
      },
      {
        staff: { unmatched: ['link'] },
        params: id,
        body: t.Object({
          linkUai: t.Optional(t.String({ pattern: '^[0-9]{7}[A-Z]$' })),
          name: t.Optional(t.String({ maxLength: 120 })),
          city: t.Optional(t.String({ maxLength: 80 })),
          newUai: t.Optional(t.String({ pattern: '^[0-9]{7}[A-Z]$' })),
        }),
        response: {
          200: t.Object({ uai: t.String(), reportId: t.String() }),
          404: t.String(),
          409: t.String(),
          422: t.String(),
        },
        detail: {
          tags: ['staff'],
          summary:
            'Attach a proposal to a school, or create the school; the report goes to moderation',
        },
      },
    )
    .delete(
      '/:id',
      async ({ params, staff }) => {
        const [p] = await db
          .delete(schema.schoolProposals)
          .where(eq(schema.schoolProposals.id, params.id))
          .returning()
        if (!p) return status(404, 'Unknown proposal')
        if (p.photoKey) await blobs.delete(p.photoKey)
        await audit(db, staff, 'proposal.reject', params.id, { name: p.name, city: p.city })
        return new Response(null, { status: 204 })
      },
      {
        staff: { report: ['edit'] },
        params: id,
        response: { 404: t.String() },
        detail: { tags: ['staff'], summary: 'Reject a proposal and delete its photo' },
      },
    )
