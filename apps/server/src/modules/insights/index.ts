/** Read-only views for the admin: the judge's opinions and the media analyses. */
import { Elysia, t } from 'elysia'
import { schema, type Database } from '@manifeste/db'
import { and, desc, eq, gte } from 'drizzle-orm'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'

export const insightsModule = (auth: Auth, db: Database) =>
  new Elysia({ name: 'module.insights', prefix: '/api/staff' })
    .use(authPlugin(auth))
    .get(
      '/judge/reports',
      ({ query }) =>
        db
          .select({
            id: schema.reports.id,
            schoolUai: schema.reports.schoolUai,
            schoolName: schema.schools.name,
            schoolCity: schema.schools.city,
            department: schema.schools.department,
            schoolLevel: schema.schools.level,
            status: schema.reports.status,
            certainty: schema.reports.certainty,
            origin: schema.reports.origin,
            tier: schema.reports.tier,
            observedAt: schema.reports.observedAt,
            sourceUrl: schema.reports.sourceUrl,
            sourceDomain: schema.reports.sourceDomain,
            probability: schema.judgements.probability,
            nature: schema.judgements.nature,
            level: schema.judgements.level,
            provider: schema.judgements.provider,
            model: schema.judgements.model,
            chars: schema.judgements.chars,
            judgedAt: schema.judgements.judgedAt,
          })
          .from(schema.reports)
          .innerJoin(schema.schools, eq(schema.schools.uai, schema.reports.schoolUai))
          .leftJoin(schema.judgements, eq(schema.judgements.reportId, schema.reports.id))
          .where(
            and(
              eq(schema.reports.moderation, 'approved'),
              eq(schema.reports.hidden, false),
              gte(
                schema.reports.observedAt,
                new Date(Date.now() - (query.days ?? 30) * 86_400_000),
              ),
            ),
          )
          .orderBy(desc(schema.reports.observedAt))
          .limit(5000),
      {
        staff: { ai: ['view'] },
        query: t.Object({ days: t.Optional(t.Numeric({ minimum: 1, maximum: 365, default: 30 })) }),
        detail: { tags: ['staff'], summary: "Published reports with the judge's opinion" },
      },
    )
    .get(
      '/media',
      ({ query }) =>
        db
          .select()
          .from(schema.mediaAnalyses)
          .where(
            gte(
              schema.mediaAnalyses.analyzedAt,
              new Date(Date.now() - (query.days ?? 30) * 86_400_000),
            ),
          )
          .orderBy(desc(schema.mediaAnalyses.publishedAt))
          .limit(5000),
      {
        staff: { ai: ['view'] },
        query: t.Object({ days: t.Optional(t.Numeric({ minimum: 1, maximum: 365, default: 30 })) }),
        detail: { tags: ['staff'], summary: 'How press articles treat the mobilisation' },
      },
    )
    .delete(
      '/media/:id',
      async ({ params, status }) => {
        const done = await db
          .delete(schema.mediaAnalyses)
          .where(eq(schema.mediaAnalyses.id, params.id))
          .returning({ id: schema.mediaAnalyses.id })
        return done.length ? new Response(null, { status: 204 }) : status(404, 'Unknown analysis')
      },
      {
        staff: { ai: ['manage'] },
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: { 404: t.String() },
        detail: { tags: ['staff'], summary: 'Delete a media analysis' },
      },
    )
