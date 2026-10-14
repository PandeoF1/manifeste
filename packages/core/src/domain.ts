/**
 * Domain of a source URL: lowercase, without "www.", "m.", "amp." or "mobile.".
 * null when the URL is invalid or not https.
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

/** Normalises a domain typed by hand ("https://www.Le-Monde.fr/" -> "le-monde.fr"). */
export function normalizeDomainInput(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  return extractDomain(raw.includes('://') ? raw.replace(/^http:/, 'https:') : `https://${raw}`)
}

/** Tracking parameters that do not change the content. */
const TRACKING_PARAM =
  /^(utm_.*|at_.*|fbclid|gclid|msclkid|xtor|xtref|cmpid|ito|mc_cid|mc_eid|igshid)$/i

/**
 * Canonical address of an article: no fragment, no tracking parameters (?at_medium=lien_RSS,
 * utm_source…), no trailing "/". The same article read from two feeds keeps one address.
 * An invalid address is returned unchanged.
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

/** A domain is trusted when it is a trusted domain or one of its subdomains. */
export function isTrustedDomain(domain: string | null, trusted: Iterable<string>): boolean {
  if (!domain) return false
  for (const d of trusted) if (domain === d || domain.endsWith(`.${d}`)) return true
  return false
}
