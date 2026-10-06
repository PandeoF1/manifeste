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
  /** Position du point (cartes My Maps) : sert à retrouver le lycée exact. */
  geo?: { lat: number; lng: number }
  /** Toujours envoyé à l'IA (pas de filtre par mots-clés) : point d'une carte de blocages. */
  alwaysRelevant?: boolean
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const USER_AGENT = 'ManifesteBot/0.1 (+https://github.com/pandeof1/manifest)'

/** Pauses avant de réessayer après un 429 / 503 (Google Actualités refuse les rafales). */
export const RETRY_DELAYS_MS = [2_500, 6_000]

export async function fetchText(
  fetchFn: FetchLike,
  url: string,
  timeoutMs = 15_000,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.ok) return await readText(res)
    const delay = retryDelaysMs[attempt]
    if ((res.status !== 429 && res.status !== 503) || delay == null) {
      throw new Error(`HTTP ${res.status} sur ${url}`)
    }
    await res.body?.cancel()
    // Un peu d'aléa : les lecteurs parallèles ne reviennent pas tous au même instant.
    await new Promise((r) => setTimeout(r, delay * (0.75 + Math.random() * 0.5)))
  }
}
