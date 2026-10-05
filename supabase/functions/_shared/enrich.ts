// Enrichissement des éléments pertinents avant l'IA :
// - Google Actualités : remplace le lien news.google.com par l'URL réelle de l'article ;
// - texte court (titre seul) : ajoute le titre et le résumé de la page (chapeau de l'article),
//   qui donnent souvent la commune et le nom du lycée.
import { mapLimit } from './collector-utils.ts'
import { extractDomain } from './domain.ts'
import { resolveGoogleNewsUrls, isGoogleNewsUrl } from './fetchers/googlenews.ts'
import type { FetchLike, ScrapedItem } from './fetchers/types.ts'
import { fetchPageContext } from './page.ts'

/** En dessous de cette longueur, le texte est un simple titre : on lit la page. */
const SHORT_TEXT = 400
const MAX_ENRICHED = 25

export async function enrichItems(
  fetchFn: FetchLike,
  items: ScrapedItem[],
): Promise<ScrapedItem[]> {
  const targets = items.slice(0, MAX_ENRICHED)
  const resolved = await resolveGoogleNewsUrls(
    fetchFn,
    targets.map((i) => i.url).filter(isGoogleNewsUrl),
  )
  const enriched = await mapLimit(targets, 5, async (item) => {
    const realUrl = resolved.get(item.url)
    const next: ScrapedItem = realUrl
      ? {
          ...item,
          url: realUrl,
          publisherDomain: item.publisherDomain ?? extractDomain(realUrl) ?? undefined,
        }
      : { ...item }
    if (next.text.length < SHORT_TEXT && !isGoogleNewsUrl(next.url)) {
      const context = await fetchPageContext(fetchFn, next.url)
      const known = new Set(next.text.split('\n').map((l) => l.trim()))
      const extra = context.split('\n').filter((l) => !known.has(l.trim()))
      if (extra.length) next.text = [next.text, ...extra].join('\n').slice(0, 4500)
    }
    return next
  })
  return [...enriched, ...items.slice(MAX_ENRICHED)]
}
