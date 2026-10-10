import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryKeys'
import { debounce } from './debounce'

/** A burst of inserts (collector) triggers a single refetch. */
const REFETCH_DELAY_MS = 3000

/**
 * Listens to reports (RLS limits the public to validated reports)
 * and invalidates the relevant queries.
 */
export function useReportsRealtime() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidateStatuses = debounce(
      () => void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all }),
      REFETCH_DELAY_MS,
    )
    const channel = supabase
      .channel('reports-validated')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports', filter: 'moderation=eq.validated' },
        (payload) => {
          invalidateStatuses()
          const row = (payload.new ?? payload.old) as { school_uai?: string } | null
          if (row?.school_uai) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.school(row.school_uai) })
          }
        },
      )
      .subscribe()
    return () => {
      invalidateStatuses.cancel()
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
