import { Elysia, t } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { StaffModel } from './model.ts'
import type { StaffService } from './service.ts'

/** Staff accounts: admins list and invite members. */
export const staffModule = (auth: Auth, service: StaffService) =>
  new Elysia({ name: 'module.staff', prefix: '/api/staff/members' })
    .use(authPlugin(auth))
    .model({ 'Staff.invite': StaffModel.invite, 'Staff.member': StaffModel.member })
    .get('/', () => service.list(), {
      staff: { user: ['list'] },
      response: { 200: t.Array(StaffModel.member) },
      detail: { tags: ['staff'], summary: 'List staff accounts' },
    })
    .post('/', ({ body }) => service.invite(body), {
      staff: { user: ['create'] },
      body: 'Staff.invite',
      response: { 200: StaffModel.invitation, 409: t.String() },
      detail: {
        tags: ['staff'],
        summary: 'Invite a staff member (returns a one-time password link)',
      },
    })
    .post('/:id/password-link', ({ params }) => service.newPasswordLink(params.id), {
      staff: { user: ['create'] },
      params: t.Object({ id: t.String() }),
      response: { 200: StaffModel.invitation, 404: t.String() },
      detail: {
        tags: ['staff'],
        summary: 'A new one-time password link for a staff member (lost password, expired invite)',
      },
    })
