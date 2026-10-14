import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/api'
import { located, type PublicReport, type SchoolStatus } from '@/lib/apiTypes'
import { queryKeys } from '@/lib/queryKeys'

export const schoolDetailQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.schoolDetail(uai),
    queryFn: () => unwrap(api.api.schools({ uai }).get()),
    staleTime: 24 * 3_600_000,
  })

/** Current status (null if there is no active signal). */
export const schoolStatusQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.school(uai),
    queryFn: async (): Promise<SchoolStatus | null> => {
      const live = located(await unwrap(api.api.statuses.get({ query: { period: 'live' } })))
      return live.find((s) => s.uai === uai) ?? null
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

/** History of validated signals over 7 days. */
export const schoolHistoryQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.schoolHistory(uai),
    queryFn: (): Promise<PublicReport[]> =>
      unwrap(api.api.schools({ uai }).reports.get({ query: { days: 7 } })),
    staleTime: 60_000,
  })
