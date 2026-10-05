import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import type { Tables, Views } from '@/lib/database.types'
import { periodSince, type Period, type PublicSettings } from '@/lib/periods'

export type SchoolStatus = Views<'school_current_status'> & {
  /** Périodes passées : nombre de jours avec un signal bloqué ou filtrant. */
  signal_days?: number
}
export type PublicReport = Pick<
  Tables<'reports'>,
  | 'id'
  | 'status'
  | 'source_type'
  | 'source_url'
  | 'source_domain'
  | 'observed_at'
  | 'photo_public_path'
>

const REFRESH_MS = 60_000

async function fetchCurrentStatuses(): Promise<SchoolStatus[]> {
  const { data, error } = await supabase
    .from('school_current_status')
    .select('*')
    .order('last_signal_at', { ascending: false })
  if (error) throw error
  return data
}

export const statusesQuery = queryOptions({
  queryKey: queryKeys.statuses.list(),
  queryFn: fetchCurrentStatuses,
  staleTime: REFRESH_MS,
  // Le polling est suspendu quand l'onglet est masqué (comportement par défaut).
  refetchInterval: REFRESH_MS,
})

/**
 * Lycées mobilisés sur une période. Le direct reprend la vue (et le cache) de la carte ;
 * les périodes passées agrègent les signaux validés depuis leur début.
 */
export const periodStatusesQuery = (period: Period, settings: PublicSettings) =>
  queryOptions<SchoolStatus[], Error, SchoolStatus[], readonly unknown[]>(
    period === 'direct'
      ? {
          queryKey: queryKeys.statuses.list(),
          queryFn: fetchCurrentStatuses,
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS,
        }
      : {
          queryKey: queryKeys.statuses.period(period, settings.movementStart),
          queryFn: async () => {
            const { data, error } = await supabase.rpc('school_status_since', {
              p_since: periodSince(period, settings).toISOString(),
            })
            if (error) throw error
            return data
          },
          staleTime: REFRESH_MS,
          refetchInterval: REFRESH_MS * 2,
        },
  )

export const schoolReportsQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.schoolReports(uai),
    queryFn: async (): Promise<PublicReport[]> => {
      const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
      const { data, error } = await supabase
        .from('reports')
        .select(
          'id, status, source_type, source_url, source_domain, observed_at, photo_public_path',
        )
        .eq('school_uai', uai)
        .eq('moderation', 'validated')
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data
    },
    staleTime: REFRESH_MS,
  })

export { computeStats, type NationalStats } from './stats'
