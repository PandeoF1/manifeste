import { Elysia, t } from 'elysia'
import { clientIp } from '../../lib/client-ip.ts'
import { contentTypeOf, type BlobStore } from '../../storage/blob-store.ts'
import { ReportsModel } from './model.ts'
import type { ReportsService } from './service.ts'

/** On-site reports (anonymous, geolocated, optional photo) and the blurred photos staff published. */
export const reportsModule = (service: ReportsService, blobs: BlobStore) =>
  new Elysia({ name: 'module.reports', prefix: '/api' })
    .post(
      '/reports',
      async ({ body, request, server, status }) => {
        const { photo, ...fields } = body
        const upload =
          photo && photo.size > 0 ? { bytes: new Uint8Array(await photo.arrayBuffer()) } : null
        const result = await service.submit(
          fields,
          upload,
          clientIp(request.headers, server?.requestIP(request)?.address),
        )
        if (result.ok) return status(201, { ok: true as const })
        return status(result.httpStatus, { ok: false as const, error: result.error })
      },
      {
        body: ReportsModel.submit,
        response: {
          201: ReportsModel.accepted,
          400: ReportsModel.refused,
          403: ReportsModel.refused,
          404: ReportsModel.refused,
          413: ReportsModel.refused,
          415: ReportsModel.refused,
          422: ReportsModel.refused,
          429: ReportsModel.refused,
          500: ReportsModel.refused,
        },
        detail: {
          tags: ['reports'],
          summary:
            'Send an on-site report (multipart, anonymous, validated by staff before publication)',
        },
      },
    )
    .get(
      '/photos/:file',
      async ({ params, set, status }) => {
        const key = `public/${params.file}`
        const bytes = await blobs.get(key)
        if (!bytes) return status(404, 'Not found')
        // The name is random and the file never changes: cache it for good.
        set.headers['cache-control'] = 'public, max-age=604800, immutable'
        set.headers['content-type'] = contentTypeOf(key)
        return new Response(bytes)
      },
      {
        params: ReportsModel.photoParams,
        response: { 404: t.String() },
        detail: { tags: ['reports'], summary: 'A published (blurred) photo' },
      },
    )
