import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import type { Tables } from '@/lib/database.types'

export type ScrapeSource = Tables<'scrape_sources'>
export type TrustedDomain = Tables<'trusted_domains'>
export type Unmatched = Tables<'unmatched_extractions'>
export type PendingReport = Tables<'reports'> & {
  schools: { name: string; city: string } | null
  scrape_sources: { label: string } | null
}

export function isAdminSession(session: Session | null): boolean {
  return session?.user.app_metadata?.role === 'admin'
}

export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: async () => (await supabase.auth.getSession()).data.session,
  staleTime: Infinity,
})

export function useSession() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      queryClient.setQueryData(queryKeys.session, session)
      if (!session) queryClient.removeQueries({ queryKey: queryKeys.admin.all })
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])
  return useQuery(sessionQuery)
}

export const sourcesQuery = queryOptions({
  queryKey: queryKeys.admin.sources(),
  queryFn: async (): Promise<ScrapeSource[]> => {
    const { data, error } = await supabase
      .from('scrape_sources')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
})

export const pendingQuery = queryOptions({
  queryKey: queryKeys.admin.pending(),
  queryFn: async (): Promise<PendingReport[]> => {
    const { data, error } = await supabase
      .from('reports')
      .select('*, schools(name, city), scrape_sources(label)')
      .eq('moderation', 'pending')
      .order('observed_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return data as PendingReport[]
  },
  refetchInterval: 60_000,
})

export const unmatchedQuery = queryOptions({
  queryKey: queryKeys.admin.unmatched(),
  queryFn: async (): Promise<Unmatched[]> => {
    const { data, error } = await supabase
      .from('unmatched_extractions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return data
  },
})

export const trustedDomainsQuery = queryOptions({
  queryKey: queryKeys.admin.trustedDomains(),
  queryFn: async (): Promise<TrustedDomain[]> => {
    const { data, error } = await supabase.from('trusted_domains').select('*').order('domain')
    if (error) throw error
    return data
  },
})

export interface CollectRunResult {
  model: string
  duration_ms: number
  results: Array<{
    source_id: string
    label: string
    fetched: number
    new_items: number
    relevant: number
    events: number
    reports: number
    duplicates: number
    unmatched: number
    low_certainty: number
    error: string | null
  }>
}

export async function runCollect(sourceId?: string): Promise<CollectRunResult> {
  const { data, error } = await supabase.functions.invoke<CollectRunResult>('collect', {
    body: sourceId ? { source_id: sourceId } : {},
  })
  if (error) throw error
  if (!data) throw new Error('Réponse vide')
  return data
}
