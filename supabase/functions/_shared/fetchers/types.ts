import { readText } from '../text.ts'

/** Un élément brut récupéré par un collecteur. Le texte n'est jamais stocké en base. */
export interface ScrapedItem {
  /** Identifiant stable dans la source (id de post, guid RSS...). */
  externalId: string
  /** URL publique de l'élément, en https. */
  url: string
  text: string
  publishedAt: Date
  /** Domaine de l'éditeur quand il diffère de l'URL (agrégateurs type Google Actualités). */
  publisherDomain?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const USER_AGENT = 'ManifesteBot/0.1 (+https://github.com/pandeof1/manifest)'

export async function fetchText(
  fetchFn: FetchLike,
  url: string,
  timeoutMs = 15_000,
): Promise<string> {
  const res = await fetchFn(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`)
  return await readText(res)
}
