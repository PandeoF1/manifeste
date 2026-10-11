import { t } from 'elysia'

export const StaffModel = {
  role: t.Union([t.Literal('admin'), t.Literal('moderator')]),
  invite: t.Object({
    email: t.String({ format: 'email', maxLength: 254 }),
    name: t.String({ minLength: 1, maxLength: 100 }),
    role: t.Union([t.Literal('admin'), t.Literal('moderator')]),
  }),
  invitation: t.Object({
    userId: t.String(),
    /** One-time link to choose a password, valid 72 h. Hand it over privately. */
    passwordLink: t.String(),
    expiresInHours: t.Integer(),
  }),
  member: t.Object({
    id: t.String(),
    email: t.String(),
    name: t.String(),
    role: t.String(),
    twoFactorEnabled: t.Boolean(),
    banned: t.Boolean(),
    createdAt: t.Date(),
  }),
} as const

export type Invite = typeof StaffModel.invite.static
export type Invitation = typeof StaffModel.invitation.static
export type StaffMember = typeof StaffModel.member.static
