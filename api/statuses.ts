// Établissements bloqués en ce moment : la carte les redemande chaque minute, pour chaque
// visiteur. Servis ici avec un cache de 30 s, ils viennent d'un serveur proche du visiteur au
// lieu de la base (Londres), et la base n'est interrogée qu'une fois par demi-minute.
// Si cette route échoue, l'appli retombe sur la base directement.
import { currentStatuses } from './_data'

export const config = { runtime: 'edge' }

export default async function handler(): Promise<Response> {
  try {
    const rows = await currentStatuses()
    return new Response(JSON.stringify(rows), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // 30 s au CDN, puis jusqu'à 60 s de plus servies pendant le rafraîchissement.
        'cache-control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
      },
    })
  } catch {
    return new Response('[]', {
      status: 502,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }
}
