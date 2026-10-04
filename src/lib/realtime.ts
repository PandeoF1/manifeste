import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryKeys'

/**
 * Écoute les reports (la RLS limite le public aux reports validés)
 * et invalide les queries concernées.
 */
export function useReportsRealtime() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const channel = supabase
      .channel('reports-validated')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports', filter: 'moderation=eq.validated' },
        (payload) => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
          const row = (payload.new ?? payload.old) as { school_uai?: string } | null
          if (row?.school_uai) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.school(row.school_uai) })
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
