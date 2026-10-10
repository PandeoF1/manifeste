import { t } from 'elysia'
import { REPORT_ORIGINS, REPORT_STATUSES, SCHOOL_LEVELS } from '@manifeste/core'

const level = t.UnionEnum([...SCHOOL_LEVELS])

export const SchoolsModel = {
  detail: t.Object({
    uai: t.String(),
    name: t.String(),
    city: t.String(),
    postcode: t.Nullable(t.String()),
    department: t.Nullable(t.String()),
    academy: t.Nullable(t.String()),
    kind: t.Nullable(t.String()),
    lat: t.Nullable(t.Number()),
    lng: t.Nullable(t.Number()),
    level,
  }),
  nearby: t.Object({
    uai: t.String(),
    name: t.String(),
    city: t.String(),
    distanceM: t.Integer(),
    level,
  }),
  hit: t.Object({
    uai: t.String(),
    name: t.String(),
    city: t.String(),
    department: t.Nullable(t.String()),
    level,
  }),
  /** A validated report as the public sees it: no internal ids of sources, no judge details. */
  report: t.Object({
    id: t.String(),
    status: t.UnionEnum([...REPORT_STATUSES]),
    origin: t.UnionEnum([...REPORT_ORIGINS]),
    sourceUrl: t.Nullable(t.String()),
    sourceDomain: t.Nullable(t.String()),
    observedAt: t.Date(),
    photoUrl: t.Nullable(t.String()),
  }),
  uaiParams: t.Object({ uai: t.String({ pattern: '^[0-9]{7}[A-Z]$' }) }),
  nearbyQuery: t.Object({
    lat: t.Number({ minimum: -90, maximum: 90 }),
    lng: t.Number({ minimum: -180, maximum: 180 }),
    radiusM: t.Integer({ minimum: 100, maximum: 5000, default: 2000 }),
  }),
  searchQuery: t.Object({ q: t.String({ minLength: 2, maxLength: 80 }) }),
  historyQuery: t.Object({ days: t.Integer({ minimum: 1, maximum: 7, default: 1 }) }),
} as const

export type SchoolDetail = typeof SchoolsModel.detail.static
export type PublicReport = typeof SchoolsModel.report.static
