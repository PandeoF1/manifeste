/**
 * Extrait le domaine d'une URL source : minuscules, sans "www." ni "m." ni "amp.".
 * Renvoie null si l'URL est invalide ou n'est pas en https.
 */
export function extractDomain(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!host.includes('.')) return null
  return host.replace(/^(www|m|amp|mobile)\./, '')
}

/** Normalise un domaine saisi à la main ("https://www.Le-Monde.fr/" -> "le-monde.fr"). */
export function normalizeDomainInput(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  return extractDomain(raw.includes('://') ? raw.replace(/^http:/, 'https:') : `https://${raw}`)
}

/** Paramètres de suivi sans effet sur le contenu (à garder synchronisé avec canonical_url en SQL). */
const TRACKING_PARAM =
  /^(utm_.*|at_.*|fbclid|gclid|msclkid|xtor|xtref|cmpid|ito|mc_cid|mc_eid|igshid)$/i

/**
 * Adresse canonique d'un article : sans fragment, sans paramètres de suivi (?at_medium=lien_RSS,
 * utm_source…) ni « / » final. Un même article reçu par deux flux garde ainsi une seule adresse.
 * Une adresse invalide est renvoyée telle quelle.
 */
export function canonicalUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return url
  }
  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key)
  }
  let out = parsed.toString()
  if (out.endsWith('?')) out = out.slice(0, -1)
  return out.replace(/\/$/, '')
}
