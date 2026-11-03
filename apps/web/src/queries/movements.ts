import { queryOptions } from '@tanstack/react-query'
import { api, reviveDates, unwrap } from '@/lib/api'
import { API_PERIOD, type Period } from '@/lib/periods'
import { queryKeys } from '@/lib/queryKeys'

/** Movements: the active ones, then the archives. A page, not a live feed: a slow refresh. */
export const movementsQuery = queryOptions({
  queryKey: queryKeys.movements.list(),
  queryFn: () => unwrap(api.api.movements.get()),
  staleTime: 60_000,
})

/** Marches with a route for the period shown: drawn on the home map when the setting is on. */
export const marchesQuery = (period: Period) =>
  queryOptions({
    queryKey: [...queryKeys.movements.all, 'marches', period],
    queryFn: async () =>
      reviveDates(await unwrap(api.api.marches.get({ query: { period: API_PERIOD[period] } }))),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

/** Mobilisations reported by the press all over France (the `signaled_mobilisations` setting). */
export const mobilisationsQuery = (period: Period) =>
  queryOptions({
    queryKey: [...queryKeys.movements.all, 'mobilisations', period],
    queryFn: async () =>
      reviveDates(
        await unwrap(api.api.mobilisations.get({ query: { period: API_PERIOD[period] } })),
      ),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

/** One movement with its published events; null when the address is unknown. */
export const movementQuery = (slug: string) =>
  queryOptions({
    queryKey: queryKeys.movements.one(slug),
    queryFn: async () => {
      const { data, error } = await api.api.movements({ slug }).get()
      if (error?.status === 404) return null
      if (error || !data) throw new Error(`HTTP ${String(error?.status)}`)
      return reviveDates(data)
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
