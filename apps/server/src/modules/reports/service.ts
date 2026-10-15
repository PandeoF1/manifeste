/**
 * On-site reports. Anonymity by construction: no account, no name, the IP only becomes a salted
 * hash (and only to count today's reports), the photo carries no metadata, the position is
 * rounded to ~100 m and readable by staff only. Nothing is published without staff validation.
 */
import { sql } from 'drizzle-orm'
import {
  parseSubmission,
  type RawSubmission,
  type Submission,
  DAILY_LIMIT,
  MAX_DISTANCE_M,
  MAX_PHOTO_BYTES,
  roundCoord,
  tierOf,
  type SubmitError,
} from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { detectImageKind, hasMetadata, type ImageKind } from '../../lib/image.ts'
import { rows } from '../../lib/sql.ts'
import { newBlobKey, type BlobStore } from '../../storage/blob-store.ts'
import type { AnalyticsService } from '../analytics/service.ts'

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: SubmitError; httpStatus: 400 | 403 | 404 | 413 | 415 | 422 | 429 | 500 }

const fail = (error: SubmitError, httpStatus: Extract<SubmitResult, { ok: false }>['httpStatus']) =>
  ({ ok: false, error, httpStatus }) as const

export interface Turnstile {
  /** Cloudflare secret; empty = skipped, which is only allowed outside production. */
  secret: string | undefined
  production: boolean
  fetchFn?: typeof fetch
}

export interface PhotoUpload {
  bytes: Uint8Array
}

export class ReportsService {
  constructor(
    private readonly db: Database,
    private readonly blobs: BlobStore,
    private readonly analytics: AnalyticsService,
    private readonly turnstile: Turnstile,
    private readonly log: { error(obj: object, msg: string): void },
  ) {}

  /** Cloudflare Turnstile. The visitor's IP is deliberately not forwarded. */
  private async captchaOk(token: string | null): Promise<boolean> {
    const { secret, production, fetchFn = fetch } = this.turnstile
    // Without a secret the check is only skipped in development: in production, a missing
    // configuration must block, not open the form to robots.
    if (!secret) return !production
    if (!token) return false
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json().catch(() => ({}))) as { success?: boolean }
    return body.success === true
  }

  /** Distance in metres from a school to a position; null when the school is unknown. */
  private async distanceM(uai: string, lat: number, lng: number): Promise<number | null> {
    const found = await rows<{ distance: number }>(
      this.db,
      sql`select round(st_distance(s.location, st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography))::int as distance
          from schools s where s.uai = ${uai} and s.location is not null`,
    )
    return found[0]?.distance ?? null
  }

  /** Counts this visitor's report today; false once the daily limit is passed. */
  private async consumeQuota(ip: string): Promise<boolean> {
    const visitor = await this.analytics.visitor(ip, 'report')
    const [row] = await rows<{ count: number }>(
      this.db,
      sql`insert into submission_limits (visitor, day, count) values (${visitor}, current_date, 1)
          on conflict (visitor, day) do update set count = submission_limits.count + 1
          returning count`,
    )
    return (row?.count ?? Infinity) <= DAILY_LIMIT
  }

  async submit(raw: RawSubmission, photo: PhotoUpload | null, ip: string): Promise<SubmitResult> {
    const input = parseSubmission(raw)
    if (!input) return fail('invalid_input', 400)
    try {
      if (!(await this.captchaOk(input.turnstileToken))) return fail('captcha_failed', 403)

      // The photo is checked before the quota is spent.
      let kind: ImageKind | null = null
      if (photo) {
        if (photo.bytes.length > MAX_PHOTO_BYTES) return fail('photo_invalid', 413)
        kind = detectImageKind(photo.bytes)
        if (!kind) return fail('photo_invalid', 415)
        if (hasMetadata(photo.bytes)) return fail('photo_metadata', 422)
      }

      // A directory school: the position must be near it. A proposed one: staff check it.
      let distance = 0
      if ('uai' in input.school) {
        const found = await this.distanceM(input.school.uai, input.lat, input.lng)
        if (found === null) return fail('unknown_school', 404)
        if (found > MAX_DISTANCE_M) return fail('too_far', 422)
        distance = found
      }

      if (!(await this.consumeQuota(ip))) return fail('rate_limited', 429)

      // A random name, unrelated to the upload.
      const photoKey = photo && kind ? newBlobKey('private', kind) : null
      if (photo && photoKey) await this.blobs.put(photoKey, photo.bytes)
      try {
        await this.store(input, distance, photoKey)
      } catch (error) {
        if (photoKey) await this.blobs.delete(photoKey)
        throw error
      }
      return { ok: true }
    } catch (error) {
      // A technical message only: nothing from the request is logged.
      this.log.error(
        { err: error instanceof Error ? error.message : 'unknown error' },
        'report submission failed',
      )
      return fail('server_error', 500)
    }
  }

  private async store(input: Submission, distance: number, photoKey: string | null) {
    const lat = roundCoord(input.lat)
    const lng = roundCoord(input.lng)
    if (!('uai' in input.school)) {
      await this.db.insert(schema.schoolProposals).values({
        name: input.school.name,
        city: input.school.city,
        status: input.status,
        mobilisation: input.mobilisation,
        lat,
        lng,
        photoKey,
        sourceUrl: input.sourceUrl,
      })
      return
    }
    const { uai } = input.school
    await this.db.transaction(async (tx) => {
      const [report] = await tx
        .insert(schema.reports)
        .values({
          schoolUai: uai,
          status: input.status,
          origin: 'on_site',
          sourceUrl: input.sourceUrl,
          sourceDomain: input.sourceDomain,
          moderation: 'pending',
          // On-site reports are never judged: a person was there, a human checks them. A
          // mobilisation signalée keeps its tier: it is shown apart, never counted as blocked.
          tier: input.mobilisation
            ? 'mobilisation'
            : tierOf({ probability: null, nature: null, status: input.status, onSite: true }),
          observedAt: new Date(),
        })
        .returning({ id: schema.reports.id })
      if (!report) throw new Error('report not inserted')
      await tx.insert(schema.reportSubmissions).values({
        reportId: report.id,
        photoKey,
        lat,
        lng,
        distanceM: distance,
      })
    })
  }
}
