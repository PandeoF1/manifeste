import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import type { Tables, Views } from '@/lib/database.types'

export type SchoolStatus = Views<'school_current_status'>
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

export const statusesQuery = queryOptions({
  queryKey: queryKeys.statuses.list(),
  queryFn: async (): Promise<SchoolStatus[]> => {
    const { data, error } = await supabase
      .from('school_current_status')
      .select('*')
      .order('last_signal_at', { ascending: false })
    if (error) throw error
    return data
  },
  staleTime: REFRESH_MS,
  // Le polling est suspendu quand l'onglet est masqué (comportement par défaut).
  refetchInterval: REFRESH_MS,
})

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
