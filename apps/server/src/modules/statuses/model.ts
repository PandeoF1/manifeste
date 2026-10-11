import { t } from 'elysia'
import { PERIODS, REPORT_STATUSES, SCHOOL_LEVELS } from '@manifeste/core'

const status = t.UnionEnum([...REPORT_STATUSES])
const level = t.UnionEnum([...SCHOOL_LEVELS])

export const StatusesModel = {
  period: t.UnionEnum([...PERIODS], { default: 'live' }),
  schoolStatus: t.Object({
    uai: t.String(),
    name: t.String(),
    city: t.String(),
    department: t.Nullable(t.String()),
    academy: t.Nullable(t.String()),
    lat: t.Nullable(t.Number()),
    lng: t.Nullable(t.Number()),
    status,
    lastSignalAt: t.Date(),
    /** Distinct sources behind the status. */
    sourceCount: t.Integer(),
    /** Past periods only: days with a blocked or filtering signal. */
    signalDays: t.Optional(t.Integer()),
    level,
  }),
} as const

export type SchoolStatus = typeof StatusesModel.schoolStatus.static
export type PeriodName = typeof StatusesModel.period.static
