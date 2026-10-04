import { z } from 'zod'

export const SCRAPE_KINDS = ['telegram', 'rss', 'bluesky'] as const
export type ScrapeKind = (typeof SCRAPE_KINDS)[number]

export const SCRAPE_KIND_LABELS: Record<ScrapeKind, string> = {
  telegram: 'Canal Telegram public',
  rss: 'Flux RSS / Atom',
  bluesky: 'Compte Bluesky',
}

export const SOURCE_TYPES_FOR_SCRAPE = ['presse', 'syndicat', 'collecteur'] as const

/** Normalise l'identifiant saisi selon le type de source, ou lève une erreur lisible. */
export function normalizeSourceIdentifier(kind: ScrapeKind, input: string): string {
  const raw = input.trim()
  switch (kind) {
    case 'telegram': {
      // Accepte "@canal", "canal", "https://t.me/canal", "https://t.me/s/canal".
      const m = raw.match(
        /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)\/?$/,
      )
      const name = m?.[1] ?? raw.replace(/^@/, '')
      if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name)) {
        throw new Error('Nom de canal Telegram invalide (5 à 32 caractères, lettres, chiffres, _).')
      }
      return name.toLowerCase()
    }
    case 'bluesky': {
      // Accepte "@handle", "handle", "https://bsky.app/profile/handle".
      const m = raw.match(/^(?:https?:\/\/)?bsky\.app\/profile\/([^/?#]+)/)
      const handle = (m?.[1] ?? raw).replace(/^@/, '').toLowerCase()
      if (!/^(did:plc:[a-z0-9]+|[a-z0-9-]+(\.[a-z0-9-]+)+)$/.test(handle)) {
        throw new Error('Handle Bluesky invalide (ex. syndicat.bsky.social).')
      }
      return handle
    }
    case 'rss': {
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        throw new Error('URL de flux invalide.')
      }
      if (url.protocol !== 'https:') throw new Error('Le flux doit être en https.')
      return url.toString()
    }
  }
}

export const newSourceSchema = z
  .object({
    kind: z.enum(SCRAPE_KINDS),
    identifier: z.string().min(1, 'Identifiant requis').max(500),
    label: z.string().trim().min(1, 'Libellé requis').max(120),
    source_type: z.enum(SOURCE_TYPES_FOR_SCRAPE),
    trusted: z.boolean(),
  })
  .transform((v, ctx) => {
    try {
      return { ...v, identifier: normalizeSourceIdentifier(v.kind, v.identifier) }
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: ['identifier'], message: (e as Error).message })
      return z.NEVER
    }
  })
export type NewSource = z.output<typeof newSourceSchema>

/** Préréglages proposés dans l'admin pour une couverture large. */
export const SOURCE_PRESETS: ReadonlyArray<Omit<NewSource, 'trusted'> & { trusted: boolean }> = [
  {
    kind: 'rss',
    identifier:
      'https://news.google.com/rss/search?q=%22blocus%22+lyc%C3%A9e+when:1d&hl=fr&gl=FR&ceid=FR:fr',
    label: 'Google Actualités : blocus lycée',
    source_type: 'presse',
    trusted: false,
  },
  {
    kind: 'rss',
    identifier:
      'https://news.google.com/rss/search?q=lyc%C3%A9e+bloqu%C3%A9+when:1d&hl=fr&gl=FR&ceid=FR:fr',
    label: 'Google Actualités : lycée bloqué',
    source_type: 'presse',
    trusted: false,
  },
]
