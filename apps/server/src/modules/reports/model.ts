import { t } from 'elysia'
import { SUBMIT_ERRORS } from '@manifeste/core'

export const ReportsModel = {
  /**
   * Multipart form. Every field is a loose string on purpose: the service validates them and
   * answers with a coded error the form translates.
   */
  submit: t.Object({
    schoolUai: t.Optional(t.String()),
    newSchoolName: t.Optional(t.String()),
    newSchoolCity: t.Optional(t.String()),
    status: t.Optional(t.String()),
    lat: t.Optional(t.String()),
    lng: t.Optional(t.String()),
    sourceUrl: t.Optional(t.String()),
    turnstileToken: t.Optional(t.String()),
    photo: t.Optional(t.File()),
  }),
  accepted: t.Object({ ok: t.Literal(true) }),
  refused: t.Object({ ok: t.Literal(false), error: t.UnionEnum([...SUBMIT_ERRORS]) }),
  photoParams: t.Object({
    file: t.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|webp)$',
    }),
  }),
} as const
