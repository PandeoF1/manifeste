/**
 * Lines that are page furniture, not article: share buttons, "read also" links, subscription
 * prompts, cookie notices. Applied to short lines only, so a real sentence that happens to
 * contain one of these words is never dropped.
 */

/** Longest line (characters) the lexicon may drop. */
const MAX_FURNITURE_CHARS = 160

const FURNITURE: RegExp[] = [
  /^(à|a) lire aussi\b/i,
  /^lire (aussi|la suite|également|notre)\b/i,
  /^(voir|à voir|a voir) aussi\b/i,
  /^(sur le même sujet|dans la même rubrique|articles? (liés?|similaires?|recommandés?))\b/i,
  /^(publicité|sponsorisé|contenu partenaire)\s*$/i,
  /\b(je m['’]abonne|abonnez-vous|abonne-toi|déjà abonné|se connecter|s['’]identifier)\b/i,
  /\b(réservé aux abonnés|article réservé|contenu réservé|pour lire la suite|la suite de cet article|lire la suite de cet article)\b/i,
  /^(partager|partagez|copier le lien|imprimer|envoyer par (e-?mail|mail)|suivez-nous|suivez nous|rejoignez-nous)\b/i,
  /\b(newsletter|inscrivez-vous|recevez nos)\b/i,
  /\b(cookies?|consentement|paramétrer vos choix|gérer mes choix)\b/i,
  /^(commentaires?|voir les commentaires|réagir|signaler)\s*(\(\d+\))?\s*$/i,
  /^(©|copyright)\b/i,
  /\btous droits réservés\b/i,
  /^(crédit|crédits|photo|photos|illustration|capture d['’]écran)\s*:/i,
  /^(source|sources)\s*:\s*\S{0,40}$/i,
  /^(lecture|temps de lecture)\s*:?\s*\d+\s*min/i,
  /^(mis à jour|publié|modifié)\s+(le|il y a)\b.{0,60}$/i,
]

export function isFurniture(line: string): boolean {
  const text = line.trim()
  if (text.length === 0) return true
  if (text.length > MAX_FURNITURE_CHARS) return false
  return FURNITURE.some((re) => re.test(text))
}
