import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { DEFAULT_SETTINGS, fromApiSettings, type PublicSettings } from '@/lib/periods'

/** Public settings (length of the live view, start of the movement). */
export const settingsQuery = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: async (): Promise<PublicSettings> =>
    fromApiSettings(await unwrap(api.api.settings.get())),
  staleTime: 10 * 60_000,
  placeholderData: DEFAULT_SETTINGS,
})
