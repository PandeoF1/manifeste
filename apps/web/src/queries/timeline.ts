import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import { periodSince, type PublicSettings } from '@/lib/periods'
import { parseTimeline, type TimelineData } from '@/lib/timeline'

/**
 * All validated reports since the start of the movement, to replay the map.
 * Loaded only in "History" mode; refreshed every 5 minutes (not on every
 * report: the response is heavy).
 */
export const timelineQuery = (settings: PublicSettings) =>
  queryOptions<TimelineData>({
    queryKey: queryKeys.timeline(settings.movementStart),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('timeline_events', {
        p_since: periodSince('tout', settings).toISOString(),
      })
      if (error) throw error
      return parseTimeline(data)
    },
    staleTime: 60_000,
    refetchInterval: 300_000,
  })
