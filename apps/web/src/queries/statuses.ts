import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/api'
import { located, type PublicReport, type SchoolStatus } from '@/lib/apiTypes'
import { queryKeys } from '@/lib/queryKeys'
import { API_PERIOD, type Period, type PublicSettings } from '@/lib/periods'

export type { PublicReport, SchoolStatus }

const REFRESH_MS = 60_000

const fetchStatuses = async (period: Period): Promise<SchoolStatus[]> =>
  located(await unwrap(api.api.statuses.get({ query: { period: API_PERIOD[period] } })))

/**
 * Reported mobilisations where the text does not say "blocked" or "closed" (gathering, incident,
 * unclear case). Empty while judge tiers are off; only requested when they are on.
 */
const fetchMobilisation = async (period: Period): Promise<SchoolStatus[]> =>
  located(
    await unwrap(api.api.statuses.mobilisation.get({ query: { period: API_PERIOD[period] } })),
  ).map((s) => ({ ...s, mobilisation: true }))

export const mobilisationQuery = queryOptions({
  queryKey: [...queryKeys.statuses.all, 'mobilisation'],
  queryFn: () => fetchMobilisation('direct'),
  staleTime: REFRESH_MS,
  refetchInterval: REFRESH_MS,
})

/** Reported mobilisations over a period. */
export const periodMobilisationQuery = (period: Period, settings: PublicSettings) =>
  queryOptions<SchoolStatus[], Error, SchoolStatus[], readonly unknown[]>({
    queryKey:
      period === 'direct'
        ? [...mobilisationQuery.queryKey]
        : [...queryKeys.statuses.all, 'mobilisation', period, settings.movementStart],
    queryFn: () => fetchMobilisation(period),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  })

export const statusesQuery = queryOptions({
  queryKey: queryKeys.statuses.list(),
  queryFn: () => fetchStatuses('direct'),
  staleTime: REFRESH_MS,
  // Polling is suspended when the tab is hidden (default behaviour).
  refetchInterval: REFRESH_MS,
})

/**
 * Mobilised schools over a period. Live reuses the map's list (and cache); past periods
 * aggregate the validated signals since their start.
 */
export const periodStatusesQuery = (period: Period, settings: PublicSettings) =>
  queryOptions<SchoolStatus[], Error, SchoolStatus[], readonly unknown[]>({
    queryKey:
      period === 'direct'
        ? queryKeys.statuses.list()
        : queryKeys.statuses.period(period, settings.movementStart),
    queryFn: () => fetchStatuses(period),
    staleTime: REFRESH_MS,
    refetchInterval: period === 'direct' ? REFRESH_MS : REFRESH_MS * 2,
  })

export const schoolReportsQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.schoolReports(uai),
    queryFn: (): Promise<PublicReport[]> =>
      unwrap(api.api.schools({ uai }).reports.get({ query: { days: 1 } })),
    staleTime: REFRESH_MS,
  })

export { computeStats, type NationalStats } from './stats'
