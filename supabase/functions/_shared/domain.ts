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
