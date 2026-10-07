import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'

export type Origine = 'presse' | 'syndicat' | 'collecteur' | 'utilisateur'

export interface Resume {
  genere_le: string
  premier_jour: string | null
  dernier_jour: string | null
  signalements: number
  etablissements: number
  departements: number
  facs: number
  sites_sources: number
  pic: { jour: string; etablissements: number; departements: number } | null
  en_ce_moment: { bloques: number; filtrants: number }
  origines: Array<{ origine: Origine; signalements: number; etablissements: number }>
}

export interface Jour {
  jour: string
  etablissements: number
  bloques: number
  filtrants: number
  leves: number
  departements: number
  lycees: number
  facs: number
  signalements: number
  via_presse: number
  via_organisations: number
  via_autres_sources: number
  via_signalements_sur_place: number
}

export interface Zone {
  zone: string
  etablissements: number
  lycees: number
  facs: number
  premier_jour: string | null
  dernier_jour: string | null
  signalements: number
  bloques_maintenant: number
  filtrants_maintenant: number
}

interface Vues {
  resume: Resume
  jours: Jour[]
  departements: Zone[]
  academies: Zone[]
}

/** L'API nomme la colonne « departement » ou « academie » ; la page utilise « zone » partout. */
function normalize<K extends keyof Vues>(vue: K, data: Vues[K]): Vues[K] {
  if ((vue !== 'departements' && vue !== 'academies') || !Array.isArray(data)) return data
  const key = vue === 'departements' ? 'departement' : 'academie'
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    zone: row.zone ?? row[key],
  })) as unknown as Vues[K]
}

/**
 * Les données ouvertes sont servies par /api/donnees (cache de 5 minutes au CDN, ouvert à
 * tous). Si la route est absente (développement) ou en panne, on interroge la base.
 */
async function fetchVue<K extends keyof Vues>(vue: K): Promise<Vues[K]> {
  try {
    const res = await fetch(`/api/donnees?vue=${vue}`, { headers: { accept: 'application/json' } })
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      const body = (await res.json()) as { donnees?: Vues[K] }
      if (body.donnees != null) return normalize(vue, body.donnees)
    }
  } catch {
    // repli ci-dessous
  }
  const { data, error } = await supabase.rpc('open_data', { p_view: vue })
  if (error) throw error
  return data as unknown as Vues[K]
}

const REFRESH_MS = 5 * 60_000

export const resumeQuery = queryOptions({
  queryKey: queryKeys.donnees('resume'),
  queryFn: () => fetchVue('resume'),
  staleTime: REFRESH_MS,
  refetchInterval: REFRESH_MS,
})

export const joursQuery = queryOptions({
  queryKey: queryKeys.donnees('jours'),
  queryFn: () => fetchVue('jours'),
  staleTime: REFRESH_MS,
  refetchInterval: REFRESH_MS,
})

export const departementsQuery = queryOptions({
  queryKey: queryKeys.donnees('departements'),
  queryFn: () => fetchVue('departements'),
  staleTime: REFRESH_MS,
})

export const academiesQuery = queryOptions({
  queryKey: queryKeys.donnees('academies'),
  queryFn: () => fetchVue('academies'),
  staleTime: REFRESH_MS,
})
