import { schema, type Database } from '@manifeste/db'

/** Who did it: the staff member of the session. */
export interface Actor {
  user: { id: string; email: string }
}

/**
 * Every staff action on reports, sources and settings leaves a line: who, what, before and after.
 * A failure to write the line must not undo the action it describes, but it is never silent.
 */
export async function audit(
  db: Database,
  actor: Actor,
  action: string,
  target: string | null,
  before: unknown = null,
  after: unknown = null,
): Promise<void> {
  try {
    await db.insert(schema.moderationAudit).values({
      actorId: actor.user.id,
      actorEmail: actor.user.email,
      action,
      target,
      before: before ?? null,
      after: after ?? null,
    })
  } catch (e) {
    console.error('audit line not written', action, e instanceof Error ? e.message : e)
  }
}
