import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import type { PublicReport, SchoolStatus } from './statuses'

export const schoolDetailQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.schoolDetail(uai),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('school_detail', { p_uai: uai })
      if (error) throw error
      return data[0] ?? null
    },
    staleTime: 24 * 3_600_000,
  })

/** Current status (null if there is no active signal). */
export const schoolStatusQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.school(uai),
    queryFn: async (): Promise<SchoolStatus | null> => {
      const { data, error } = await supabase
        .from('school_current_status')
        .select('*')
        .eq('uai', uai)
        .maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

/** History of validated signals over 7 days. */
export const schoolHistoryQuery = (uai: string) =>
  queryOptions({
    queryKey: queryKeys.schoolHistory(uai),
    queryFn: async (): Promise<PublicReport[]> => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data, error } = await supabase
        .from('reports')
        .select(
          'id, status, source_type, source_url, source_domain, observed_at, photo_public_path',
        )
        .eq('school_uai', uai)
        .eq('moderation', 'validated')
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data
    },
    staleTime: 60_000,
  })
