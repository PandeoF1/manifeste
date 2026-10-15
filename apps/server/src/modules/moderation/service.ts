/**
 * The moderation queue and the edits staff can make to a report. Every action is audited and
 * tells the realtime bus, so open maps and admin tabs refresh.
 */
import { MAX_PHOTO_BYTES, tierOf } from '@manifeste/core'
import { schema, type Database } from '@manifeste/db'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { status } from 'elysia'
import { audit, type Actor } from '../../lib/audit.ts'
import { detectImageKind, hasMetadata } from '../../lib/image.ts'
import { escapeLike, rows } from '../../lib/sql.ts'
import type { EventBus } from '../../realtime/bus.ts'
import { newBlobKey, type BlobStore } from '../../storage/blob-store.ts'
import type { SettingsService } from '../settings/service.ts'
import type { ModerationModel } from './model.ts'

type Patch = typeof ModerationModel.patch.static
type ListQuery = typeof ModerationModel.listQuery.static

interface PendingRow {
  id: string
  schoolUai: string
  schoolName: string | null
  schoolCity: string | null
  status: 'blocked' | 'filtering' | 'lifted'
  origin: 'press' | 'union' | 'aggregator' | 'on_site'
  observedAt: Date
  sourceUrl: string | null
  sourceDomain: string | null
  sourceLabel: string | null
  certainty: 'high' | 'medium' | 'low' | null
  distanceM: number | null
  hasPhoto: boolean
  judgeProbability: number | null
  judgeNature: string | null
  hasJudgement: boolean
  tier: 'confirmed' | 'mobilisation' | 'not_retained' | 'unjudged'
}

export class ModerationService {
  constructor(
    private readonly db: Database,
    private readonly blobs: BlobStore,
    private readonly bus: EventBus | null,
    private readonly settings: Pick<SettingsService, 'all'>,
  ) {}

  private signal(topics: Array<'statuses' | 'moderation'>, uai?: string) {
    if (!this.bus) return
    for (const topic of topics)
      void this.bus.publish({ topic, data: uai ? { uai } : {} }).catch(() => {})
  }

  /** The queue, oldest decision first. Moderators never see the position or the internal source. */
  async pending(role: 'admin' | 'moderator') {
    const found = await rows<PendingRow>(
      this.db,
      sql`select r.id, r.school_uai as "schoolUai", s.name as "schoolName", s.city as "schoolCity",
            r.status, r.origin, r.observed_at as "observedAt", r.source_url as "sourceUrl",
            r.source_domain as "sourceDomain", src.label as "sourceLabel", r.certainty,
            rs.distance_m as "distanceM", (rs.photo_key is not null) as "hasPhoto",
            j.probability as "judgeProbability", j.nature as "judgeNature",
            (j.report_id is not null) as "hasJudgement", r.tier
          from reports r
          left join schools s on s.uai = r.school_uai
          left join sources src on src.id = r.source_id
          left join report_submissions rs on rs.report_id = r.id
          left join judgements j on j.report_id = r.id
          where r.moderation = 'pending'
          order by r.observed_at desc
          limit 200`,
    )
    return found.map((r) => ({
      id: r.id,
      schoolUai: r.schoolUai,
      schoolName: r.schoolName,
      schoolCity: r.schoolCity,
      status: r.status,
      origin: r.origin,
      observedAt: new Date(r.observedAt),
      sourceUrl: r.sourceUrl,
      sourceDomain: r.sourceDomain,
      sourceLabel: role === 'admin' ? r.sourceLabel : null,
      certainty: r.certainty,
      distanceM: r.distanceM,
      hasPhoto: r.hasPhoto,
      judge: r.hasJudgement ? { probability: r.judgeProbability, nature: r.judgeNature } : null,
      tier: r.tier,
    }))
  }

  /** Recent reports of every state, for the admin "Reports" tab. */
  async list(q: ListQuery) {
    const found = await this.db
      .select({
        id: schema.reports.id,
        schoolUai: schema.reports.schoolUai,
        schoolName: schema.schools.name,
        schoolCity: schema.schools.city,
        status: schema.reports.status,
        origin: schema.reports.origin,
        moderation: schema.reports.moderation,
        hidden: schema.reports.hidden,
        observedAt: schema.reports.observedAt,
        sourceUrl: schema.reports.sourceUrl,
        sourceDomain: schema.reports.sourceDomain,
        sourceLabel: schema.sources.label,
        certainty: schema.reports.certainty,
        tier: schema.reports.tier,
        photoKey: schema.reports.photoKey,
        createdAt: schema.reports.createdAt,
      })
      .from(schema.reports)
      .leftJoin(schema.schools, eq(schema.schools.uai, schema.reports.schoolUai))
      .leftJoin(schema.sources, eq(schema.sources.id, schema.reports.sourceId))
      .where(
        and(
          q.moderation ? eq(schema.reports.moderation, q.moderation) : undefined,
          q.hidden !== undefined ? eq(schema.reports.hidden, q.hidden) : undefined,
          q.q
            ? or(
                ilike(schema.schools.name, `%${escapeLike(q.q)}%`),
                ilike(schema.schools.city, `%${escapeLike(q.q)}%`),
                ilike(schema.reports.sourceDomain, `%${escapeLike(q.q)}%`),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.reports.observedAt))
      .limit(q.limit ?? 300)
    return found.map(({ photoKey, ...r }) => ({ ...r, hasPhoto: photoKey !== null }))
  }

  /** Approve or reject a pending report. The original photo goes in every case. */
  async decide(
    id: string,
    decision: 'approve' | 'reject',
    photo: Uint8Array | null,
    actor: Actor & { user: { id: string; email: string } },
  ) {
    const [report] = await this.db
      .select({
        id: schema.reports.id,
        moderation: schema.reports.moderation,
        uai: schema.reports.schoolUai,
      })
      .from(schema.reports)
      .where(eq(schema.reports.id, id))
    if (!report) return status(404, 'Unknown report')
    if (report.moderation !== 'pending') return status(409, 'This report was already decided')

    let publicFile: string | null = null
    if (decision === 'approve' && photo) {
      if (photo.length > MAX_PHOTO_BYTES) return status(413, 'The photo is too large')
      const kind = detectImageKind(photo)
      if (!kind) return status(415, 'The photo must be a JPEG or WebP image')
      if (hasMetadata(photo))
        return status(422, 'The photo carries metadata: blur and re-encode it')
      const key = newBlobKey('public', kind)
      await this.blobs.put(key, photo)
      publicFile = key.slice('public/'.length)
    }

    // Only a report that is still pending can be decided: two moderators opening the same one
    // must not both "win" (the second one is told it was already decided).
    const decided = await this.db
      .update(schema.reports)
      .set({
        moderation: decision === 'approve' ? 'approved' : 'rejected',
        moderatedAt: new Date(),
        moderatedBy: actor.user.id,
        ...(publicFile && { photoKey: publicFile }),
      })
      .where(and(eq(schema.reports.id, id), eq(schema.reports.moderation, 'pending')))
      .returning({ id: schema.reports.id })
    if (decided.length === 0) {
      // Lost the race: the blurred photo we just stored belongs to nobody.
      if (publicFile) await this.blobs.delete(`public/${publicFile}`)
      return status(409, 'This report was already decided')
    }
    await this.dropOriginal(id)
    await audit(
      this.db,
      actor,
      `report.${decision}`,
      id,
      { moderation: 'pending' },
      { photo: publicFile !== null },
    )
    this.signal(decision === 'approve' ? ['statuses', 'moderation'] : ['moderation'], report.uai)
    return { ok: true as const }
  }

  /** Deletes the private original of a report, wherever it is recorded. */
  private async dropOriginal(reportId: string) {
    const [sub] = await this.db
      .select({ key: schema.reportSubmissions.photoKey })
      .from(schema.reportSubmissions)
      .where(eq(schema.reportSubmissions.reportId, reportId))
    if (sub?.key) {
      await this.blobs.delete(sub.key)
      await this.db
        .update(schema.reportSubmissions)
        .set({ photoKey: null })
        .where(eq(schema.reportSubmissions.reportId, reportId))
    }
  }

  /** The original photo of a pending report (staff only, never cached). */
  async originalPhoto(id: string) {
    const [sub] = await this.db
      .select({ key: schema.reportSubmissions.photoKey })
      .from(schema.reportSubmissions)
      .where(eq(schema.reportSubmissions.reportId, id))
    if (!sub?.key) return null
    return this.blobs.get(sub.key)
  }

  async update(id: string, patch: Patch, actor: Actor) {
    const [before] = await this.db.select().from(schema.reports).where(eq(schema.reports.id, id))
    if (!before) return status(404, 'Unknown report')
    if (patch.schoolUai) {
      const [school] = await this.db
        .select({ uai: schema.schools.uai })
        .from(schema.schools)
        .where(eq(schema.schools.uai, patch.schoolUai))
      if (!school) return status(422, 'Unknown school')
    }
    const nextStatus = patch.status ?? before.status
    // A new status can change what the judge's answer means: recompute the tier.
    const tier = patch.status
      ? await this.tierFor(id, nextStatus, patch.schoolUai ?? before.schoolUai, before)
      : undefined
    await this.db
      .update(schema.reports)
      .set({
        ...(patch.schoolUai && { schoolUai: patch.schoolUai }),
        ...(patch.status && { status: patch.status }),
        ...(patch.observedAt && { observedAt: patch.observedAt }),
        ...(patch.moderation && { moderation: patch.moderation, moderatedAt: new Date() }),
        ...(tier && { tier }),
      })
      .where(eq(schema.reports.id, id))
    await audit(
      this.db,
      actor,
      'report.update',
      id,
      {
        schoolUai: before.schoolUai,
        status: before.status,
        observedAt: before.observedAt,
        moderation: before.moderation,
      },
      patch,
    )
    this.signal(['statuses', 'moderation'], patch.schoolUai ?? before.schoolUai)
    return { ok: true as const }
  }

  private async tierFor(
    id: string,
    reportStatus: 'blocked' | 'filtering' | 'lifted',
    uai: string,
    before: { origin: string; tier: string },
  ) {
    const [judgement] = await this.db
      .select()
      .from(schema.judgements)
      .where(eq(schema.judgements.reportId, id))
    // No judge opinion: an on-site report keeps its tier (a mobilisation stays one), any other is unjudged.
    if (!judgement)
      return before.origin === 'on_site'
        ? before.tier === 'mobilisation'
          ? 'mobilisation'
          : 'confirmed'
        : ('unjudged' as const)
    const [school] = await this.db
      .select({ level: schema.schools.level })
      .from(schema.schools)
      .where(eq(schema.schools.uai, uai))
    const settings = await this.settings.all()
    const conflict =
      judgement.level != null &&
      judgement.level !== 'unknown' &&
      school != null &&
      judgement.level !== school.level
    return tierOf(
      {
        probability: judgement.probability,
        nature: judgement.nature,
        status: reportStatus,
        levelConflict: conflict,
      },
      { keep: settings.judge_keep, low: settings.judge_low },
    )
  }

  async setHidden(id: string, hidden: boolean, actor: Actor) {
    const done = await this.db
      .update(schema.reports)
      .set({ hidden })
      .where(eq(schema.reports.id, id))
      .returning({ uai: schema.reports.schoolUai })
    if (done.length === 0) return status(404, 'Unknown report')
    await audit(this.db, actor, hidden ? 'report.hide' : 'report.unhide', id)
    this.signal(['statuses'], done[0]?.uai)
    return { ok: true as const }
  }

  async remove(id: string, actor: Actor) {
    const [report] = await this.db.select().from(schema.reports).where(eq(schema.reports.id, id))
    if (!report) return status(404, 'Unknown report')
    await this.dropOriginal(id)
    if (report.photoKey) await this.blobs.delete(`public/${report.photoKey}`)
    await this.db.delete(schema.reports).where(eq(schema.reports.id, id))
    await audit(this.db, actor, 'report.delete', id, {
      schoolUai: report.schoolUai,
      status: report.status,
      sourceUrl: report.sourceUrl,
    })
    this.signal(['statuses', 'moderation'], report.schoolUai)
    return new Response(null, { status: 204 })
  }

  /** Sends a collected report back to the staff queue of unmatched facts, and withdraws it. */
  async toUnmatched(id: string, actor: Actor) {
    const [report] = await this.db.select().from(schema.reports).where(eq(schema.reports.id, id))
    if (!report) return status(404, 'Unknown report')
    if (report.origin === 'on_site' || !report.sourceUrl)
      return status(422, 'Only a collected report can go back to the queue')
    const [school] = await this.db
      .select({ name: schema.schools.name, city: schema.schools.city })
      .from(schema.schools)
      .where(eq(schema.schools.uai, report.schoolUai))
    const [extraction] = await this.db
      .select({
        id: schema.extractions.id,
        name: schema.extractions.schoolName,
        city: schema.extractions.city,
      })
      .from(schema.extractions)
      .where(eq(schema.extractions.reportId, id))
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.unmatched).values({
        extractionId: extraction?.id ?? null,
        sourceId: report.sourceId,
        sourceDomain: report.sourceDomain,
        schoolName: extraction?.name ?? school?.name ?? report.schoolUai,
        city: extraction?.city ?? school?.city ?? null,
        status: report.status,
        sourceUrl: report.sourceUrl as string,
        observedAt: report.observedAt,
      })
      if (extraction)
        await tx
          .update(schema.extractions)
          .set({
            outcome: 'unmatched',
            outcomeDetail: 'sent back by staff',
            schoolUai: null,
            reportId: null,
          })
          .where(eq(schema.extractions.id, extraction.id))
      await tx.delete(schema.reports).where(eq(schema.reports.id, id))
    })
    await audit(this.db, actor, 'report.to-unmatched', id, { schoolUai: report.schoolUai })
    this.signal(['statuses', 'moderation'], report.schoolUai)
    return { ok: true as const }
  }
}
