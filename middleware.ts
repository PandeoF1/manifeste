// La page d'accueil est un fichier (index.html), servi avant les réécritures de vercel.json :
// ce middleware envoie les robots (aperçus, moteurs) vers /api/share comme les autres pages.
import { next, rewrite } from '@vercel/functions'
import { isBot } from './api/_bots'

export const config = { matcher: '/' }

export default function middleware(req: Request): Response {
  if (!isBot(req.headers.get('user-agent'))) return next()
  return rewrite(new URL('/api/share', req.url))
}
