import { extractDomain, parseRoute, slugify } from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { memoWithTtl } from '../../lib/memo.ts'
import type { EventView, MovementView } from './model.ts'

type Movement = typeof schema.movements.$inferSelect
type EventRow = typeof schema.movementEvents.$inferSelect

/** A failure the route turns into an HTTP status. */
export class MovementError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message)
  }
}

const PUBLIC = and(
  eq(schema.movementEvents.moderation, 'approved'),
  eq(schema.movementEvents.hidden, false),
)

const viewOf = (m: Movement, eventCount: number): MovementView => ({
  id: m.id,
  slug: m.slug,
  name: m.name,
  description: m.description,
  status: m.status,
  startsAt: m.startsAt,
  endsAt: m.endsAt,
  eventCount,
})

const eventView = (e: EventRow): EventView => ({
  id: e.id,
  kind: e.kind,
  title: e.title,
  place: e.place,
  status: e.status,
  startsAt: e.startsAt,
  endsAt: e.endsAt,
  lat: e.lat,
  lng: e.lng,
  route: e.route,
  routeBasis: e.routeBasis,
  sourceUrl: e.sourceUrl,
  sourceDomain: e.sourceDomain,
})

/** The row an insert or update returned; a missing one is a bug, not a user error. */
function returned<T>(rows: T[]): T {
  const [row] = rows
  if (!row) throw new Error('The database returned no row')
  return row
}

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { cause?: { code?: string } }).cause?.code === '23505'

/** Movements and their events: public reads (cached) and staff writes. */
export class MovementsService {
  constructor(private readonly db: Database) {}

  private readonly listCache = memoWithTtl(60_000, () => this.loadList())
  private readonly oneCache = memoWithTtl(60_000, (slug: string) => this.loadOne(slug))

  /** Active movements first, then the archives, the most recent first. */
  list(): Promise<MovementView[]> {
    return this.listCache.get(undefined as never)
  }

  /** A movement and its published events, oldest first (the order of a day). */
  one(slug: string): Promise<{ movement: MovementView; events: EventView[] } | null> {
    return this.oneCache.get(slug)
  }

  private invalidate() {
    this.listCache.clear()
    this.oneCache.clear()
  }

  private async loadList(): Promise<MovementView[]> {
    const m = schema.movements
    const rows = await this.db
      .select({
        movement: m,
        eventCount: sql<number>`count(${schema.movementEvents.id}) filter (where ${PUBLIC})::int`,
      })
      .from(m)
      .leftJoin(schema.movementEvents, eq(schema.movementEvents.movementId, m.id))
      .groupBy(m.id)
      .orderBy(asc(m.status), desc(m.startsAt))
    return rows.map((r) => viewOf(r.movement, r.eventCount))
  }

  private async loadOne(slug: string) {
    const [movement] = await this.db
      .select()
      .from(schema.movements)
      .where(eq(schema.movements.slug, slug))
    if (!movement) return null
    const events = await this.db
      .select()
      .from(schema.movementEvents)
      .where(and(eq(schema.movementEvents.movementId, movement.id), PUBLIC))
      .orderBy(asc(schema.movementEvents.startsAt))
    return { movement: viewOf(movement, events.length), events: events.map(eventView) }
  }

  async create(input: {
    name: string
    slug?: string
    description?: string
    startsAt: Date
  }): Promise<MovementView> {
    const slug = input.slug ?? slugify(input.name)
    if (!slug) throw new MovementError('invalid', 'The name gives no usable address')
    try {
      const row = returned(
        await this.db
          .insert(schema.movements)
          .values({
            slug,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            startsAt: input.startsAt,
          })
          .returning(),
      )
      this.invalidate()
      return viewOf(row, 0)
    } catch (e) {
      if (isUniqueViolation(e)) throw new MovementError('conflict', 'This address is taken')
      throw e
    }
  }

  /**
   * Archiving sets the end date (now, unless one is given) and keeps everything. Reopening clears it.
   */
  async patch(
    id: string,
    input: {
      name?: string
      description?: string | null
      status?: Movement['status']
      startsAt?: Date
      endsAt?: Date | null
    },
  ): Promise<{ before: Movement; after: Movement }> {
    const [before] = await this.db
      .select()
      .from(schema.movements)
      .where(eq(schema.movements.id, id))
    if (!before) throw new MovementError('not_found', 'Unknown movement')
    const patch: Partial<typeof schema.movements.$inferInsert> = {}
    if (input.name !== undefined) patch.name = input.name.trim()
    if (input.description !== undefined) patch.description = input.description?.trim() || null
    if (input.startsAt !== undefined) patch.startsAt = input.startsAt
    if (input.status !== undefined) {
      patch.status = input.status
      if (input.status === 'archived') patch.endsAt = input.endsAt ?? before.endsAt ?? new Date()
      else patch.endsAt = null
    } else if (input.endsAt !== undefined) patch.endsAt = input.endsAt
    const startsAt = patch.startsAt ?? before.startsAt
    const endsAt = patch.endsAt === undefined ? before.endsAt : patch.endsAt
    if (endsAt && endsAt < startsAt)
      throw new MovementError('invalid', 'The end is before the start')
    if (Object.keys(patch).length === 0) return { before, after: before }
    const after = returned(
      await this.db
        .update(schema.movements)
        .set(patch)
        .where(eq(schema.movements.id, id))
        .returning(),
    )
    this.invalidate()
    return { before, after }
  }

  /** Staff-entered events are published at once; the automatic pipeline will go through moderation. */
  async addEvent(
    movementId: string,
    input: {
      kind: EventRow['kind']
      title: string
      place?: string
      status?: EventRow['status']
      startsAt: Date
      endsAt?: Date
      lat?: number
      lng?: number
      route?: unknown
      routeBasis?: EventRow['routeBasis']
      sourceUrl?: string
    },
  ): Promise<EventView> {
    const [movement] = await this.db
      .select({ id: schema.movements.id })
      .from(schema.movements)
      .where(eq(schema.movements.id, movementId))
    if (!movement) throw new MovementError('not_found', 'Unknown movement')
    if ((input.lat === undefined) !== (input.lng === undefined))
      throw new MovementError('invalid', 'Latitude and longitude go together')
    if (input.endsAt && input.endsAt < input.startsAt)
      throw new MovementError('invalid', 'The end is before the start')
    const route = input.route === undefined ? null : parseRoute(input.route)
    if (input.route !== undefined && !route) throw new MovementError('invalid', 'Invalid route')
    if (route && !input.routeBasis)
      throw new MovementError('invalid', 'A route needs its basis (announced or probable)')
    const source = this.sourceOf(input.sourceUrl)
    const row = returned(
      await this.db
        .insert(schema.movementEvents)
        .values({
          movementId,
          kind: input.kind,
          title: input.title.trim(),
          place: input.place?.trim() || null,
          status: input.status ?? 'planned',
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          route: route ? route.map(([lng, lat]) => [lng, lat] as [number, number]) : null,
          routeBasis: route ? (input.routeBasis ?? null) : null,
          sourceUrl: source?.url ?? null,
          sourceDomain: source?.domain ?? null,
          moderation: 'approved',
        })
        .returning(),
    )
    this.invalidate()
    return eventView(row)
  }

  async patchEvent(
    id: string,
    input: {
      title?: string
      place?: string | null
      status?: EventRow['status']
      startsAt?: Date
      endsAt?: Date | null
      route?: unknown
      routeBasis?: EventRow['routeBasis']
      hidden?: boolean
    },
  ): Promise<{ before: EventRow; after: EventRow }> {
    const [before] = await this.db
      .select()
      .from(schema.movementEvents)
      .where(eq(schema.movementEvents.id, id))
    if (!before) throw new MovementError('not_found', 'Unknown event')
    const patch: Partial<typeof schema.movementEvents.$inferInsert> = {}
    if (input.title !== undefined) patch.title = input.title.trim()
    if (input.place !== undefined) patch.place = input.place?.trim() || null
    if (input.status !== undefined) patch.status = input.status
    if (input.startsAt !== undefined) patch.startsAt = input.startsAt
    if (input.endsAt !== undefined) patch.endsAt = input.endsAt
    if (input.hidden !== undefined) patch.hidden = input.hidden
    if (input.route !== undefined) {
      if (input.route === null) {
        patch.route = null
        patch.routeBasis = null
      } else {
        const route = parseRoute(input.route)
        if (!route) throw new MovementError('invalid', 'Invalid route')
        const basis = input.routeBasis ?? before.routeBasis
        if (!basis) throw new MovementError('invalid', 'A route needs its basis')
        patch.route = route.map(([lng, lat]) => [lng, lat] as [number, number])
        patch.routeBasis = basis
      }
    } else if (input.routeBasis !== undefined && before.route) patch.routeBasis = input.routeBasis
    const startsAt = patch.startsAt ?? before.startsAt
    const endsAt = patch.endsAt === undefined ? before.endsAt : patch.endsAt
    if (endsAt && endsAt < startsAt)
      throw new MovementError('invalid', 'The end is before the start')
    if (Object.keys(patch).length === 0) return { before, after: before }
    const after = returned(
      await this.db
        .update(schema.movementEvents)
        .set(patch)
        .where(eq(schema.movementEvents.id, id))
        .returning(),
    )
    this.invalidate()
    return { before, after }
  }

  private sourceOf(raw: string | undefined): { url: string; domain: string } | null {
    if (!raw) return null
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new MovementError('invalid', 'Invalid source link')
    }
    if (url.protocol !== 'https:')
      throw new MovementError('invalid', 'The source link must be https')
    const domain = extractDomain(url.toString())
    if (!domain) throw new MovementError('invalid', 'Invalid source link')
    return { url: url.toString(), domain }
  }
}
