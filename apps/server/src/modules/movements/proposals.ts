import { schema, type Database } from '@manifeste/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Elysia, status, t } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { audit } from '../../lib/audit.ts'
import { groupKeyOf, walkPlaces } from '../../ingest/routes-stage.ts'
import type { FetchLike } from '../../ingest/types.ts'
import { MovementError, type MovementsService } from './service.ts'

type Row = typeof schema.routeProposals.$inferSelect
type Place = Row['places'][number]

const placeView = t.Object({
  name: t.String(),
  quote: t.String(),
  lng: t.Nullable(t.Number()),
  lat: t.Nullable(t.Number()),
  status: t.Union([t.Literal('ok'), t.Literal('weak'), t.Literal('none')]),
  label: t.Nullable(t.String()),
})
const view = t.Object({
  id: t.String(),
  url: t.String(),
  domain: t.String(),
  articleTitle: t.Nullable(t.String()),
  publishedAt: t.Nullable(t.Date()),
  city: t.String(),
  day: t.Nullable(t.String()),
  timing: t.String(),
  title: t.String(),
  places: t.Array(placeView),
  line: t.Nullable(t.Array(t.Tuple([t.Number(), t.Number()]))),
  lineKm: t.Nullable(t.Number()),
  warnings: t.Array(t.String()),
  groupKey: t.String(),
  status: t.String(),
  eventId: t.Nullable(t.String()),
  createdAt: t.Date(),
})
export type ProposalView = typeof view.static

const toView = (r: Row): ProposalView => ({
  id: r.id,
  url: r.url,
  domain: r.domain,
  articleTitle: r.articleTitle,
  publishedAt: r.publishedAt,
  city: r.city,
  day: r.day,
  timing: r.timing,
  title: r.title,
  places: r.places,
  line: r.line,
  lineKm: r.lineKm,
  warnings: r.warnings,
  groupKey: r.groupKey,
  status: r.status,
  eventId: r.eventId,
  createdAt: r.createdAt,
})

/** Route proposals found by the detection, and the decisions of the people who check them. */
export class RouteProposalsService {
  constructor(
    private readonly db: Database,
    private readonly movements: MovementsService,
    private readonly fetchFn: FetchLike,
  ) {}

  /** Pending first (the work to do), then the recently decided; grouped by march on the client. */
  async list(statusFilter: 'pending' | 'decided'): Promise<ProposalView[]> {
    const where =
      statusFilter === 'pending'
        ? eq(schema.routeProposals.status, 'pending')
        : inArray(schema.routeProposals.status, ['approved', 'rejected'])
    const rows = await this.db
      .select()
      .from(schema.routeProposals)
      .where(where)
      .orderBy(desc(schema.routeProposals.createdAt))
      .limit(200)
    return rows.map(toView)
  }

  private async get(id: string): Promise<Row> {
    const [row] = await this.db
      .select()
      .from(schema.routeProposals)
      .where(eq(schema.routeProposals.id, id))
    if (!row) throw new MovementError('not_found', 'Unknown proposal')
    return row
  }

  /**
   * A person corrects a proposal: a point put by hand counts as checked ("ok"), a point cleared
   * is missing. The walking route and the warnings are computed again from the corrected points.
   */
  async patch(
    id: string,
    input: {
      title?: string
      city?: string
      day?: string | null
      places?: Array<{ name: string; lng: number | null; lat: number | null }>
    },
  ): Promise<{ before: Row; after: Row }> {
    const before = await this.get(id)
    if (before.status !== 'pending')
      throw new MovementError('conflict', 'This proposal was already decided')
    const patch: Partial<typeof schema.routeProposals.$inferInsert> = {}
    if (input.title !== undefined) patch.title = input.title.trim()
    if (input.city !== undefined) patch.city = input.city.trim()
    if (input.day !== undefined) patch.day = input.day
    if (input.places) {
      if (input.places.length < 2) throw new MovementError('invalid', 'A route needs two places')
      const places: Place[] = input.places.map((p, i) => {
        const old = before.places[i]
        const moved = old?.lng !== p.lng || old?.lat !== p.lat
        if (p.lng == null || p.lat == null)
          return {
            name: p.name,
            quote: old?.quote ?? '',
            lng: null,
            lat: null,
            status: 'none',
            label: null,
          }
        return {
          name: p.name,
          quote: old?.quote ?? '',
          lng: p.lng,
          lat: p.lat,
          status: moved ? 'ok' : (old?.status ?? 'ok'),
          label: moved ? 'Placé à la main' : (old?.label ?? null),
        }
      })
      const walk = await walkPlaces(this.fetchFn, places)
      patch.places = places
      patch.line = walk.line
      patch.lineKm = walk.route?.km ?? null
      patch.warnings = walk.warnings
    }
    if (patch.warnings && !(patch.day ?? before.day))
      patch.warnings.push('Date du cortège absente de l’article')
    if (patch.city !== undefined || patch.day !== undefined)
      patch.groupKey = groupKeyOf(
        before.citycode,
        patch.city ?? before.city,
        patch.day === undefined ? before.day : patch.day,
      )
    if (Object.keys(patch).length === 0) return { before, after: before }
    const [after] = await this.db
      .update(schema.routeProposals)
      .set(patch)
      .where(eq(schema.routeProposals.id, id))
      .returning()
    if (!after) throw new Error('The database returned no row')
    return { before, after }
  }

  /**
   * Approving creates the movement event: a march with its route marked "probable" (computed
   * between places an article names; the map says so). It needs every place checked and a route.
   */
  async approve(
    id: string,
    input: { movementId: string; startsAt: Date; rejectOthers?: boolean },
  ): Promise<{ proposal: Row; eventId: string; rejected: string[] }> {
    const p = await this.get(id)
    if (p.status !== 'pending')
      throw new MovementError('conflict', 'This proposal was already decided')
    if (!p.line || p.line.length < 2)
      throw new MovementError('invalid', 'No route to publish: check the places first')
    if (p.places.some((x) => x.status !== 'ok'))
      throw new MovementError('invalid', 'Every place must be found or placed by hand')
    const first = p.places[0]
    const event = await this.movements.addEvent(input.movementId, {
      kind: 'march',
      title: p.title,
      place: p.city,
      startsAt: input.startsAt,
      ...(first?.lng != null && first.lat != null && { lng: first.lng, lat: first.lat }),
      route: p.line,
      routeBasis: 'probable',
      ...(p.url.startsWith('https://') && { sourceUrl: p.url }),
    })
    const [done] = await this.db
      .update(schema.routeProposals)
      .set({ status: 'approved', eventId: event.id, decidedAt: new Date() })
      .where(eq(schema.routeProposals.id, id))
      .returning()
    if (!done) throw new Error('The database returned no row')
    let rejected: string[] = []
    if (input.rejectOthers) {
      const others = await this.db
        .update(schema.routeProposals)
        .set({ status: 'rejected', decidedAt: new Date() })
        .where(
          and(
            eq(schema.routeProposals.groupKey, p.groupKey),
            eq(schema.routeProposals.status, 'pending'),
          ),
        )
        .returning({ id: schema.routeProposals.id })
      rejected = others.map((o) => o.id)
    }
    return { proposal: done, eventId: event.id, rejected }
  }

  async reject(id: string): Promise<Row> {
    const p = await this.get(id)
    if (p.status !== 'pending')
      throw new MovementError('conflict', 'This proposal was already decided')
    const [done] = await this.db
      .update(schema.routeProposals)
      .set({ status: 'rejected', decidedAt: new Date() })
      .where(eq(schema.routeProposals.id, id))
      .returning()
    if (!done) throw new Error('The database returned no row')
    return done
  }
}

const guard = async <T>(run: () => Promise<T>) => {
  try {
    return await run()
  } catch (e) {
    if (!(e instanceof MovementError)) throw e
    if (e.code === 'not_found') return status(404, e.message)
    if (e.code === 'conflict') return status(409, e.message)
    return status(422, e.message)
  }
}

const idParams = t.Object({ id: t.String({ format: 'uuid' }) })
const errors = { 404: t.String(), 409: t.String(), 422: t.String() }

/** Staff: the waiting list of detected routes. Nothing here is public. */
export const routeProposalsStaffModule = (
  auth: Auth,
  db: Parameters<typeof audit>[0],
  service: RouteProposalsService,
) =>
  new Elysia({ name: 'module.route-proposals.staff', prefix: '/api/staff' })
    .use(authPlugin(auth))
    .get('/route-proposals', ({ query }) => service.list(query.status ?? 'pending'), {
      staff: { movement: ['manage'] },
      query: t.Object({
        status: t.Optional(t.Union([t.Literal('pending'), t.Literal('decided')])),
      }),
      response: { 200: t.Array(view) },
      detail: { tags: ['staff'], summary: 'Marches found in the press, waiting for a person' },
    })
    .patch(
      '/route-proposals/:id',
      ({ params, body, staff }) =>
        guard(async () => {
          const { before, after } = await service.patch(params.id, body)
          await audit(db, staff, 'route-proposal.update', after.id, before, after)
          return toView(after)
        }),
      {
        staff: { movement: ['manage'] },
        params: idParams,
        body: t.Object({
          title: t.Optional(t.String({ minLength: 3, maxLength: 160 })),
          city: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
          day: t.Optional(t.Nullable(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }))),
          places: t.Optional(
            t.Array(
              t.Object({
                name: t.String({ minLength: 1, maxLength: 120 }),
                lng: t.Nullable(t.Number({ minimum: -180, maximum: 180 })),
                lat: t.Nullable(t.Number({ minimum: -90, maximum: 90 })),
              }),
              { minItems: 2, maxItems: 20 },
            ),
          ),
        }),
        response: { 200: view, ...errors },
        detail: {
          tags: ['staff'],
          summary: 'Correct a proposal (points, title, day); the route is recomputed',
        },
      },
    )
    .post(
      '/route-proposals/:id/approve',
      ({ params, body, staff }) =>
        guard(async () => {
          const { proposal, eventId, rejected } = await service.approve(params.id, body)
          await audit(db, staff, 'route-proposal.approve', proposal.id, null, { eventId, rejected })
          return { eventId, rejected }
        }),
      {
        staff: { movement: ['manage'] },
        params: idParams,
        body: t.Object({
          movementId: t.String({ format: 'uuid' }),
          startsAt: t.Date(),
          rejectOthers: t.Optional(t.Boolean()),
        }),
        response: {
          200: t.Object({ eventId: t.String(), rejected: t.Array(t.String()) }),
          ...errors,
        },
        detail: { tags: ['staff'], summary: 'Approve: creates the march (route "probable")' },
      },
    )
    .post(
      '/route-proposals/:id/reject',
      ({ params, staff }) =>
        guard(async () => {
          const done = await service.reject(params.id)
          await audit(db, staff, 'route-proposal.reject', done.id, null, null)
          return { ok: true as const }
        }),
      {
        staff: { movement: ['manage'] },
        params: idParams,
        response: { 200: t.Object({ ok: t.Literal(true) }), ...errors },
        detail: { tags: ['staff'], summary: 'Reject a proposal' },
      },
    )
