import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import { periodSince, type PublicSettings } from '@/lib/periods'
import { parseTimeline, type TimelineData } from '@/lib/timeline'

/**
 * Tous les signalements validés depuis le début du mouvement, pour rejouer la carte.
 * Chargé seulement en mode « Historique » ; rafraîchi toutes les 2 minutes (pas à chaque
 * signalement : la réponse est lourde).
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
    refetchInterval: 120_000,
  })
