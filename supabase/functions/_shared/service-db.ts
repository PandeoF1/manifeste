// Accès base du collecteur (service role), partagé entre les Edge Functions (Deno) et le CLI
// de rattrapage (Node) : ne dépend que du client Supabase passé en paramètre.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CollectorDb } from './collector.ts'
import type { SchoolCandidate } from './matching.ts'
import type { TraceEvent } from './trace.ts'

export function createServiceDb(admin: SupabaseClient): CollectorDb {
  return {
    async seenIds(sourceId, externalIds) {
      // Par paquets : la requête passe dans l'URL et les identifiants Google Actualités
      // (~250 caractères) la font vite dépasser ce que la passerelle accepte.
      const seen = new Set<string>()
      for (const batch of batchByLength(externalIds, 3_000, 50)) {
        const { data, error } = await admin
          .from('scraped_items')
          .select('external_id')
          .eq('source_id', sourceId)
          .in('external_id', batch)
        if (error) throw new Error(`scraped_items: ${error.message}`)
        for (const r of data) seen.add(r.external_id as string)
      }
      return seen
    },
    async markSeen(sourceId, externalIds) {
      if (externalIds.length === 0) return
      const { error } = await admin.from('scraped_items').upsert(
        externalIds.map((external_id) => ({ source_id: sourceId, external_id })),
        { onConflict: 'source_id,external_id', ignoreDuplicates: true },
      )
      if (error) throw new Error(`scraped_items: ${error.message}`)
    },
    async nearbySchools(lat, lng) {
      const { data, error } = await admin.rpc('nearby_schools', {
        p_lat: lat,
        p_lng: lng,
        p_radius_m: 1500,
      })
      if (error) throw new Error(`nearby_schools: ${error.message}`)
      return (data ?? []) as Array<{ uai: string; name: string; distance_m: number }>
    },
    async schoolsInCity(city, level) {
      const { data, error } = await admin.rpc('schools_in_city', {
        p_city: city,
        p_limit: 2,
        p_level: level,
      })
      if (error) throw new Error(`schools_in_city: ${error.message}`)
      return (data ?? []) as Array<{ uai: string }>
    },
    async matchSchool(name, city) {
      const { data, error } = await admin.rpc('match_school', {
        p_name: name,
        p_city: city,
        p_limit: 5,
      })
      if (error) throw new Error(`match_school: ${error.message}`)
      return (data ?? []) as SchoolCandidate[]
    },
    async schoolLevel(uai) {
      const { data, error } = await admin
        .from('schools')
        .select('level')
        .eq('uai', uai)
        .maybeSingle()
      if (error) throw new Error(`schools: ${error.message}`)
      return (data?.level as 'lycee' | 'superieur' | undefined) ?? null
    },
    async insertReport(report) {
      // ON CONFLICT DO NOTHING : un doublon ne lève plus d'erreur (ni de ligne rouge dans les
      // journaux Postgres) ; aucune ligne renvoyée = déjà connu.
      const { data, error } = await admin
        .from('reports')
        .upsert(report, { onConflict: 'source_url,school_uai,status', ignoreDuplicates: true })
        .select('id')
      if (error) {
        if (error.code === '23505') return 'duplicate'
        throw new Error(`reports: ${error.message}`)
      }
      return data.length > 0 ? 'inserted' : 'duplicate'
    },
    async insertUnmatched(row) {
      const { error } = await admin.from('unmatched_extractions').insert(row)
      if (error) throw new Error(`unmatched_extractions: ${error.message}`)
    },
    async recordRun(r) {
      await admin
        .from('scrape_sources')
        .update({ last_run_at: new Date().toISOString(), last_error: r.error })
        .eq('id', r.source_id)
      // Journal : seulement s'il y a eu du nouveau ou une erreur (pas de lignes vides).
      if (r.items.length === 0 && !r.error) return
      const { data: run, error } = await admin
        .from('collector_runs')
        .insert({
          source_id: r.source_id,
          fetched: r.fetched,
          new_items: r.new_items,
          relevant: r.relevant,
          events: r.events,
          reports: r.reports,
          duplicates: r.duplicates,
          unmatched: r.unmatched,
          low_certainty: r.low_certainty,
          error: r.error,
        })
        .select('id')
        .single()
      if (error || !run || r.items.length === 0) return
      await admin.from('collector_item_logs').insert(
        r.items.map((i) => ({
          run_id: run.id,
          external_id: i.external_id.slice(0, 500),
          url: i.url.slice(0, 2000),
          outcome: i.outcome,
          school_name: i.school_name ?? null,
          city: i.city ?? null,
          school_uai: i.school_uai ?? null,
          status: i.status ?? null,
          detail: i.detail ?? null,
        })),
      )
    },
  }
}

/** Écriture des traces du mode direct (insertions groupées). */
export function traceSink(admin: SupabaseClient) {
  return async (events: TraceEvent[]) => {
    const { error } = await admin
      .from('collector_trace')
      .insert(events.map(({ t, ...e }) => ({ ...e, t: new Date(t).toISOString() })))
    if (error) throw new Error(`collector_trace: ${error.message}`)
  }
}

/** Découpe une liste en paquets d'au plus `maxChars` caractères cumulés et `maxItems` éléments. */
export function batchByLength(values: string[], maxChars: number, maxItems: number): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const v of values) {
    if (cur.length && (len + v.length > maxChars || cur.length >= maxItems)) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(v)
    len += v.length
  }
  if (cur.length) out.push(cur)
  return out
}
