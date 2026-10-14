// Secret partagé avec pg_cron : celui du Vault (lu une fois par instance), ou à défaut la
// variable d'environnement COLLECT_SECRET (passée par l'appelant).
import type { SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from './http.ts'

let cached: Promise<string> | null = null

export function collectSecret(admin: SupabaseClient, envSecret = ''): Promise<string> {
  cached ??= Promise.resolve(admin.rpc('collect_secret')).then(({ data, error }) => {
    if (error || typeof data !== 'string' || !data) {
      cached = null // nouvel essai au prochain appel
      return envSecret
    }
    return data
  })
  return cached
}

/** En-tête x-collect-secret valide (secret du Vault ou, à défaut, de l'environnement). */
export async function hasCollectSecret(
  req: Request,
  admin: SupabaseClient,
  envSecret = '',
): Promise<boolean> {
  const given = req.headers.get('x-collect-secret') ?? ''
  if (!given) return false
  if (envSecret && timingSafeEqual(given, envSecret)) return true
  return timingSafeEqual(given, await collectSecret(admin, envSecret))
}
