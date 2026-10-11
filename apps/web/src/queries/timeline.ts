import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import type { PublicSettings } from '@/lib/periods'
import { fromApiTimeline, type TimelineData } from '@/lib/timeline'

/**
 * All validated reports since the start of the movement, to replay the map. Loaded only in
 * "History" mode; refreshed every 5 minutes (not on every report: the response is heavy).
 */
export const timelineQuery = (settings: PublicSettings) =>
  queryOptions<TimelineData>({
    queryKey: queryKeys.timeline(settings.movementStart),
    queryFn: async () =>
      fromApiTimeline(await unwrap(api.api.timeline.get({ query: { period: 'all' } }))),
    staleTime: 60_000,
    refetchInterval: 300_000,
  })
