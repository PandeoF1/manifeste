import { randomBytes } from 'node:crypto'
import { asc } from 'drizzle-orm'
import { status } from 'elysia'
import { schema, type Database } from '@manifeste/db'
import { capturePasswordLink, PASSWORD_LINK_TTL_SECONDS, type Auth } from '../../auth/auth.ts'
import type { Invitation, Invite, StaffMember } from './model.ts'

export class StaffService {
  constructor(
    private readonly db: Database,
    private readonly auth: Auth,
    private readonly publicUrl: string,
  ) {}

  async list(): Promise<StaffMember[]> {
    const rows = await this.db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        name: schema.user.name,
        role: schema.user.role,
        twoFactorEnabled: schema.user.twoFactorEnabled,
        banned: schema.user.banned,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .orderBy(asc(schema.user.createdAt))
    return rows.map((r) => ({
      ...r,
      twoFactorEnabled: r.twoFactorEnabled ?? false,
      banned: r.banned ?? false,
    }))
  }

  /**
   * Creates a staff account with an unusable random password and returns a one-time link
   * to choose one. Nothing is emailed: the inviter hands the link over.
   */
  async invite(input: Invite) {
    const email = input.email.trim().toLowerCase()
    const existing = await this.db.query.user.findFirst({
      where: (u, { eq }) => eq(u.email, email),
      columns: { id: true },
    })
    if (existing) return status(409, 'A staff account already uses this email')

    const created = await this.auth.api.createUser({
      body: {
        email,
        name: input.name.trim(),
        role: input.role,
        password: randomBytes(32).toString('base64url'),
      },
    })
    const passwordLink = await this.passwordLink(email)
    return {
      userId: created.user.id,
      passwordLink,
      expiresInHours: PASSWORD_LINK_TTL_SECONDS / 3600,
    } satisfies Invitation
  }

  /** New one-time password link for an existing account (lost password, expired invite). */
  passwordLink(email: string): Promise<string> {
    return capturePasswordLink(() =>
      this.auth.api.requestPasswordReset({
        body: { email, redirectTo: `${this.publicUrl}/admin/mot-de-passe` },
      }),
    )
  }
}
