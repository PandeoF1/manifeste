import { Elysia, t } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { ModerationModel } from './model.ts'
import type { ModerationService } from './service.ts'
import { bytesResponse } from '../../lib/response.ts'

const okBody = t.Object({ ok: t.Literal(true) })

/** Moderation of reports: the queue (moderators and admins) and the edits (admins). */
export const moderationModule = (auth: Auth, service: ModerationService) =>
  new Elysia({ name: 'module.moderation', prefix: '/api/staff/reports' })
    .use(authPlugin(auth))
    .get(
      '/pending',
      ({ staff }) => service.pending(staff.user.role === 'admin' ? 'admin' : 'moderator'),
      {
        staff: { report: ['moderate'] },
        response: { 200: t.Array(ModerationModel.pending) },
        detail: {
          tags: ['staff'],
          summary: 'Reports waiting for a decision (moderators see no position or internal source)',
        },
      },
    )
    .post('/:id/decision', ({ params, body, staff }) => decide(service, params.id, body, staff), {
      staff: { report: ['moderate'] },
      params: ModerationModel.id,
      body: ModerationModel.decision,
      response: {
        200: okBody,
        404: t.String(),
        409: t.String(),
        413: t.String(),
        415: t.String(),
        422: t.String(),
      },
      detail: {
        tags: ['staff'],
        summary: 'Approve (with an optional blurred photo) or reject a pending report',
      },
    })
    .get(
      '/:id/original-photo',
      async ({ params, status }) => {
        const bytes = await service.originalPhoto(params.id)
        if (!bytes) return status(404, 'No photo')
        return bytesResponse(bytes, {
          'content-type': 'image/jpeg',
          'cache-control': 'private, no-store',
        })
      },
      {
        staff: { report: ['moderate'] },
        params: ModerationModel.id,
        response: { 404: t.String() },
        detail: {
          tags: ['staff'],
          summary: 'The original photo of a pending on-site report (never cached)',
        },
      },
    )
    .get('/', ({ query }) => service.list(query), {
      staff: { report: ['edit'] },
      query: ModerationModel.listQuery,
      response: { 200: t.Array(ModerationModel.report) },
      detail: { tags: ['staff'], summary: 'Recent reports of every state' },
    })
    .patch('/:id', ({ params, body, staff }) => service.update(params.id, body, staff), {
      staff: { report: ['edit'] },
      params: ModerationModel.id,
      body: ModerationModel.patch,
      response: { 200: okBody, 404: t.String(), 422: t.String() },
      detail: {
        tags: ['staff'],
        summary: 'Change the school, status, time or moderation of a report',
      },
    })
    .post(
      '/:id/hidden',
      ({ params, body, staff }) => service.setHidden(params.id, body.hidden, staff),
      {
        staff: { report: ['hide'] },
        params: ModerationModel.id,
        body: ModerationModel.hidden,
        response: { 200: okBody, 404: t.String() },
        detail: { tags: ['staff'], summary: 'Hide a report from every public view and count' },
      },
    )
    .post('/:id/to-unmatched', ({ params, staff }) => service.toUnmatched(params.id, staff), {
      staff: { report: ['edit'] },
      params: ModerationModel.id,
      response: { 200: okBody, 404: t.String(), 422: t.String() },
      detail: {
        tags: ['staff'],
        summary: 'Withdraw a collected report and send its fact back to the unmatched queue',
      },
    })
    .delete('/:id', ({ params, staff }) => service.remove(params.id, staff), {
      staff: { report: ['edit'] },
      params: ModerationModel.id,
      response: { 404: t.String() },
      detail: { tags: ['staff'], summary: 'Delete a report and its photos' },
    })

async function decide(
  service: ModerationService,
  id: string,
  body: typeof ModerationModel.decision.static,
  staff: { user: { id: string; email: string } },
) {
  const photo =
    body.photo && body.photo.size > 0 ? new Uint8Array(await body.photo.arrayBuffer()) : null
  return service.decide(id, body.decision, photo, staff)
}
