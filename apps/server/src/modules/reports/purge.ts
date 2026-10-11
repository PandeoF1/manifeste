/**
 * Photo and submission retention, with two layers so that originals cannot linger:
 *  1. by the database: an original goes once its report is decided, or after 48 h;
 *  2. by the disk: any private blob older than 48 h is deleted whatever the database says
 *     (an upload whose insert failed, a row removed by hand, a bug).
 * Also: undecided on-site reports are rejected after 48 h, and unreviewed school proposals are
 * deleted after 7 days with their photo.
 */
import { sql } from 'drizzle-orm'
import { PHOTO_RETENTION_HOURS } from '@manifeste/core'
import type { Database } from '@manifeste/db'
import { rows } from '../../lib/sql.ts'
import type { BlobStore } from '../../storage/blob-store.ts'

const PROPOSAL_RETENTION_DAYS = 7

export interface PurgeResult {
  photosDeleted: number
  reportsRejected: number
  proposalsDeleted: number
  orphansSwept: number
}

export class PurgeService {
  constructor(
    private readonly db: Database,
    private readonly blobs: BlobStore,
  ) {}

  async run(now: Date = new Date()): Promise<PurgeResult> {
    const cutoff = new Date(now.getTime() - PHOTO_RETENTION_HOURS * 3_600_000)

    // 1. Originals of decided or stale reports.
    const stale = await rows<{ reportId: string; photoKey: string }>(
      this.db,
      sql`select rs.report_id as "reportId", rs.photo_key as "photoKey"
          from report_submissions rs join reports r on r.id = rs.report_id
          where rs.photo_key is not null
            and (r.moderation <> 'pending' or rs.created_at < ${cutoff.toISOString()}::timestamptz)
          limit 500`,
    )
    for (const row of stale) {
      await this.blobs.delete(row.photoKey)
      await this.db.execute(
        sql`update report_submissions set photo_key = null where report_id = ${row.reportId}`,
      )
    }

    // An on-site report left undecided for 48 h is no longer news: rejected.
    const rejected = await rows<{ id: string }>(
      this.db,
      sql`update reports set moderation = 'rejected', moderated_at = now()
          where moderation = 'pending' and origin = 'on_site' and created_at < ${cutoff.toISOString()}::timestamptz
          returning id`,
    )

    // Proposed schools nobody handled within a week, with their photo.
    const proposalCutoff = new Date(now.getTime() - PROPOSAL_RETENTION_DAYS * 86_400_000)
    const proposals = await rows<{ id: string; photoKey: string | null }>(
      this.db,
      sql`select id, photo_key as "photoKey" from school_proposals
          where created_at < ${proposalCutoff.toISOString()}::timestamptz limit 500`,
    )
    for (const p of proposals) {
      if (p.photoKey) await this.blobs.delete(p.photoKey)
      await this.db.execute(sql`delete from school_proposals where id = ${p.id}`)
    }

    // 2. The disk sweeper: nothing private survives the retention window.
    let orphansSwept = 0
    for (const blob of await this.blobs.list('private')) {
      if (blob.modifiedAt < cutoff) {
        await this.blobs.delete(blob.key)
        orphansSwept++
      }
    }

    return {
      photosDeleted: stale.length,
      reportsRejected: rejected.length,
      proposalsDeleted: proposals.length,
      orphansSwept,
    }
  }
}
