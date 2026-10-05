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
 * - Flux RSS directs : liens vers le site de l'éditeur, validés eux aussi par trusted_domains.
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
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('"blocage des lycées"'),
    label: 'Google Actualités : blocage des lycées',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (Google Actualités)',
    kind: 'rss',
    identifier: gnews('"blocus des lycées"'),
    label: 'Google Actualités : blocus des lycées',
    source_type: 'presse',
    trusted: false,
  },
  // Flux RSS directs des rédactions (les plus présentes sur les cartes de blocages existantes)
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.franceinfo.fr/societe/education.rss',
    label: 'franceinfo : éducation',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://france3-regions.franceinfo.fr/societe/rss',
    label: 'France 3 Régions : société',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.bfmtv.com/rss/societe/',
    label: 'BFMTV : société',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.lemonde.fr/education/rss_full.xml',
    label: 'Le Monde : éducation',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.europe1.fr/rss.xml',
    label: 'Europe 1',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.ladepeche.fr/rss.xml',
    label: 'La Dépêche',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.midilibre.fr/rss.xml',
    label: 'Midi Libre',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.lindependant.fr/rss.xml',
    label: "L'Indépendant",
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.nicematin.com/rss',
    label: 'Nice-Matin',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.sudouest.fr/rss.xml',
    label: 'Sud Ouest',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.letelegramme.fr/rss.xml',
    label: 'Le Télégramme',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.ouest-france.fr/rss/une',
    label: 'Ouest-France : la une',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.republicain-lorrain.fr/rss',
    label: 'Le Républicain lorrain',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.bondyblog.fr/feed/',
    label: 'Bondy Blog',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse (flux RSS directs)',
    kind: 'rss',
    identifier: 'https://www.cafepedagogique.net/feed/',
    label: 'Café pédagogique',
    source_type: 'presse',
    trusted: false,
  },
  // Presse nationale
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.franceinfo.fr/titres.rss',
    label: 'franceinfo : à la une',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.lefigaro.fr/rss/figaro_actualite-france.xml',
    label: 'Le Figaro : France',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.liberation.fr/arc/outboundfeeds/rss-all/?outputType=xml',
    label: 'Libération',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.lejdd.fr/rss.xml',
    label: 'Le JDD',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.lexpress.fr/arc/outboundfeeds/rss/alaune.xml',
    label: "L'Express",
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.20minutes.fr/feeds/rss-une.xml',
    label: '20 Minutes',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.rfi.fr/fr/france/rss',
    label: 'RFI : France',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.mediapart.fr/articles/feed',
    label: 'Mediapart',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse nationale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.humanite.fr/feed',
    label: "L'Humanité",
    source_type: 'presse',
    trusted: false,
  },
  // Presse régionale (groupe EBRA et Sud-Ouest)
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.estrepublicain.fr/rss',
    label: "L'Est Républicain",
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.vosgesmatin.fr/rss',
    label: 'Vosges Matin',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.ledauphine.com/rss',
    label: 'Le Dauphiné libéré',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.lalsace.fr/rss',
    label: "L'Alsace",
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.dna.fr/rss',
    label: 'DNA',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.bienpublic.com/rss',
    label: 'Le Bien public',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.leprogres.fr/rss',
    label: 'Le Progrès',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.larepubliquedespyrenees.fr/rss.xml',
    label: 'La République des Pyrénées',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Presse régionale (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.charentelibre.fr/rss.xml',
    label: 'Charente libre',
    source_type: 'presse',
    trusted: false,
  },
  // Médias indépendants et militants : pas de domaine de confiance, passent par la concordance ou la modération
  {
    group: 'Médias indépendants (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.revolutionpermanente.fr/spip.php?page=backend',
    label: 'Révolution Permanente (site)',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Médias indépendants (flux RSS)',
    kind: 'rss',
    identifier: 'https://reporterre.net/spip.php?page=backend',
    label: 'Reporterre',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Médias indépendants (flux RSS)',
    kind: 'rss',
    identifier: 'https://basta.media/spip.php?page=backend',
    label: 'Basta!',
    source_type: 'presse',
    trusted: false,
  },
  {
    group: 'Médias indépendants (flux RSS)',
    kind: 'rss',
    identifier: 'https://www.rue89strasbourg.com/feed',
    label: 'Rue89 Strasbourg',
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
