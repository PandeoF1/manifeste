import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import type { Tables } from '@/lib/database.types'

export interface JudgedReport {
  id: string
  school_uai: string
  status: Tables<'reports'>['status']
  certainty: Tables<'reports'>['certainty']
  observed_at: string
  source_type: Tables<'reports'>['source_type']
  source_url: string | null
  source_domain: string | null
  judge_score: number | null
  judge_nature: Tables<'reports'>['judge_nature']
  judge_level: Tables<'reports'>['judge_level']
  judge_model: string | null
  judged_at: string | null
  judge_chars: number | null
  schools: { name: string; city: string; department: string; level: string } | null
}

const PAGE = 1000
const MAX_PAGES = 10

/** Signalements publiés avec l'avis du juge (lecture seule, pour la page « Juge » de l'admin). */
export const judgedReportsQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'judge'],
  queryFn: async (): Promise<JudgedReport[]> => {
    const rows: JudgedReport[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from('reports')
        .select(
          'id, school_uai, status, certainty, observed_at, source_type, source_url, source_domain, judge_score, judge_nature, judge_level, judge_model, judged_at, judge_chars, schools(name, city, department, level)',
        )
        .eq('moderation', 'validated')
        .eq('hidden', false)
        .order('observed_at', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw error
      rows.push(...(data as unknown as JudgedReport[]))
      if (data.length < PAGE) break
    }
    return rows
  },
  staleTime: 60_000,
})
