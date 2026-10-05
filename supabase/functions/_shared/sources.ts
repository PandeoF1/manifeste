import { z } from 'zod'

export const SCRAPE_KINDS = ['telegram', 'rss', 'bluesky', 'mymaps'] as const
export type ScrapeKind = (typeof SCRAPE_KINDS)[number]

export const SCRAPE_KIND_LABELS: Record<ScrapeKind, string> = {
  telegram: 'Canal Telegram public',
  rss: 'Flux RSS / Atom',
  bluesky: 'Compte Bluesky',
  mymaps: 'Carte Google My Maps',
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
    case 'mymaps': {
      // Accepte le lien de la carte (viewer, edit, embed, kml) ou directement son identifiant.
      const mid = raw.match(/[?&]mid=([A-Za-z0-9_-]+)/)?.[1] ?? raw
      if (!/^[A-Za-z0-9_-]{10,}$/.test(mid)) {
        throw new Error('Lien de carte My Maps invalide (il doit contenir « mid= »).')
      }
      return mid
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

export type SourcePreset = NewSource & { group: string }

const gnews = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:1d&hl=fr&gl=FR&ceid=FR:fr`

/**
 * Préréglages proposés dans l'admin (identifiants vérifiés le 2026-10-05).
 * - Presse en ligne via Google Actualités : le domaine de l'éditeur réel est utilisé pour la
 *   validation par trusted_domains, d'où trusted: false au niveau de la source.
 * - Comptes Bluesky officiels de rédactions : de confiance.
 * - Canaux militants et médias indépendants : utiles pour la réactivité, mais pas de confiance
 *   (leurs signaux passent par la concordance ou la modération).
 */
export const SOURCE_PRESETS: ReadonlyArray<SourcePreset> = [
  // Presse en ligne (Google Actualités)
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('"blocus" lycée'),
    label: 'Google Actualités : blocus lycée',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('lycée bloqué'),
    label: 'Google Actualités : lycée bloqué',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('lycéens mobilisés'),
    label: 'Google Actualités : lycéens mobilisés',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('"barrage filtrant" lycée'),
    label: 'Google Actualités : barrage filtrant lycée',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('lycées fermés mobilisation'),
    label: 'Google Actualités : lycées fermés',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('blocage lycées'),
    label: 'Google Actualités : blocage lycées',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('mobilisation lycéenne'),
    label: 'Google Actualités : mobilisation lycéenne',
    source_type: 'presse',
    trusted: false,
  },
  // Rédactions sur Bluesky
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'franceinfo.fr',
    label: 'franceinfo (Bluesky)',
    source_type: 'presse',
    trusted: true,
  },
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'lemonde.fr',
    label: 'Le Monde (Bluesky)',
    source_type: 'presse',
    trusted: true,
  },
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'liberation.fr',
    label: 'Libération (Bluesky)',
    source_type: 'presse',
    trusted: true,
  },
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'mediapart.fr',
    label: 'Mediapart (Bluesky)',
    source_type: 'presse',
    trusted: true,
  },
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'leparisien.fr',
    label: 'Le Parisien (Bluesky)',
    source_type: 'presse',
    trusted: true,
  },
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'ouest-france.fr',
    label: 'Ouest-France (Bluesky)',
    source_type: 'presse',
    trusted: true,
  },
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'actu.fr',
    label: 'actu.fr (Bluesky)',
    source_type: 'presse',
    trusted: true,
  },
  {
    group: 'Rédactions sur Bluesky',
    kind: 'bluesky',
    identifier: 'rapportsdeforce.bsky.social',
    label: 'Rapports de force / Basta! (Bluesky)',
    source_type: 'presse',
    trusted: false,
  },
  // Canaux Telegram publics (luttes sociales, réactifs sur les blocages)
  {
    group: 'Canaux Telegram',
    kind: 'telegram',
    identifier: 'revolution_permanente',
    label: 'Révolution Permanente (Telegram)',
    source_type: 'collecteur',
    trusted: false,
  },
  {
    group: 'Canaux Telegram',
    kind: 'telegram',
    identifier: 'cerveauxnondisponibles',
    label: 'Cerveaux non disponibles (Telegram)',
    source_type: 'collecteur',
    trusted: false,
  },
  {
    group: 'Canaux Telegram',
    kind: 'telegram',
    identifier: 'contre_attaque',
    label: 'Contre Attaque (Telegram)',
    source_type: 'collecteur',
    trusted: false,
  },
  {
    group: 'Canaux Telegram',
    kind: 'telegram',
    identifier: 'rapportsdeforce',
    label: 'Rapports de force (Telegram)',
    source_type: 'presse',
    trusted: false,
  },
]
