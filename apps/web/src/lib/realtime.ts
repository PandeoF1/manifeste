import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryKeys'
import { debounce } from './debounce'

/** Une rafale d'insertions (collecteur) ne déclenche qu'un seul rechargement. */
const REFETCH_DELAY_MS = 3000

/**
 * Écoute les reports (la RLS limite le public aux reports validés)
 * et invalide les queries concernées.
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
