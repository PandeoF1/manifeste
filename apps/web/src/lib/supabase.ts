import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies (voir .env.example).',
  )
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // A session only exists for the admin; the public never has one.
    persistSession: true,
    autoRefreshToken: true,
  },
})
