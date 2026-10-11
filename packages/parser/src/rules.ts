/**
 * What is known about specific sites, as data. A rule never replaces the generic extraction; it
 * only tells it where the article is (`body`) and what to leave out (`remove`), for sites whose
 * markup the generic scoring gets wrong. Every rule must earn its place in the benchmark.
 */
export interface SiteRule {
  /** Hosts the rule applies to ("ici.fr" also covers "www.ici.fr"); omit for every site. */
  hosts?: string[]
  /** CSS selectors of the article body, tried in order. */
  body?: string[]
  /** CSS selectors of elements to drop inside the article. */
  remove?: string[]
}

export const SITE_RULES: SiteRule[] = [
  // Markup shared by many regional sites of the same publisher groups.
  { body: ['.single-body', '.article__body', '[x-ref="articleBodyRef"]'] },
  {
    // Page furniture seen inside article bodies (related links, share bars, paywall prompts).
    remove: [
      '.EditorialInfosPublication',
      '.deeplinkAndSocialNetworksWithBorder',
      '.LocaleList',
      '.entry-meta',
      '#recommendedSection',
      '#infoFeedSection',
      '#IciBounceArticle',
      '#SocialNetworks',
      '#popin__container',
    ],
  },
]

/** The rules that apply to a host. */
export function rulesFor(host: string): SiteRule[] {
  const bare = host.replace(/^(www|m|amp)\./, '')
  return SITE_RULES.filter(
    (r) => !r.hosts || r.hosts.some((h) => bare === h || bare.endsWith(`.${h}`)),
  )
}
