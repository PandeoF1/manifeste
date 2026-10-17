import { queryOptions } from '@tanstack/react-query'
import { api, reviveDates, unwrap } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

/** Movements: the active ones, then the archives. A page, not a live feed: a slow refresh. */
export const movementsQuery = queryOptions({
  queryKey: queryKeys.movements.list(),
  queryFn: () => unwrap(api.api.movements.get()),
  staleTime: 60_000,
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
