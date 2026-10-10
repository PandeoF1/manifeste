/** URL publique d'une photo validée (bucket public "photos"). */
export function publicPhotoUrl(path: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/photos/${encodeURIComponent(path)}`
}
