import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import { DEFAULT_SETTINGS, parseSettings, type PublicSettings } from '@/lib/periods'

/** Public settings (length of the live view, start of the movement). */
export const settingsQuery = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: async (): Promise<PublicSettings> => {
    const { data, error } = await supabase.from('app_settings').select('key, value')
    if (error) throw error
    return parseSettings(data)
  },
  staleTime: 10 * 60_000,
  placeholderData: DEFAULT_SETTINGS,
})
