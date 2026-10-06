// Onglet admin « Médias » : agrégation des analyses d'articles par média et par propriétaire,
// et constats calculés par des règles explicites (pas par l'IA).

export interface MediaRow {
  url: string
  domain: string
  title: string | null
  published_at: string | null
  about_movement: boolean
  mentions_demands: boolean
  demands: string[]
  voices: string[]
  focus: 'revendications' | 'mobilisation' | 'incidents' | 'mixte'
  incidents: boolean
  police_violence: boolean
  terms: string[]
  tone: 'favorable' | 'neutre' | 'defavorable'
  quote_demands: string | null
  quote_framing: string | null
}

/**
 * Média et propriétaire, d'après les informations publiques (à compléter ou corriger ici).
 * Les domaines absents s'affichent tels quels, propriétaire « non renseigné ».
 */
export const OUTLETS: Record<string, { name: string; owner: string }> = {
  'lemonde.fr': { name: 'Le Monde', owner: 'Groupe Le Monde' },
  'lefigaro.fr': { name: 'Le Figaro', owner: 'Groupe Dassault' },
  'liberation.fr': { name: 'Libération', owner: 'Presse indépendante (fonds de dotation)' },
  'leparisien.fr': { name: 'Le Parisien', owner: 'LVMH (Bernard Arnault)' },
  'lesechos.fr': { name: 'Les Échos', owner: 'LVMH (Bernard Arnault)' },
  'cnews.fr': { name: 'CNews', owner: 'Groupe Canal+ (Bolloré)' },
  'europe1.fr': { name: 'Europe 1', owner: 'Lagardère (Bolloré)' },
  'lejdd.fr': { name: 'Le JDD', owner: 'Lagardère (Bolloré)' },
  'bfmtv.com': { name: 'BFMTV', owner: 'CMA CGM (Rodolphe Saadé)' },
  'rmc.bfmtv.com': { name: 'RMC', owner: 'CMA CGM (Rodolphe Saadé)' },
  'laprovence.com': { name: 'La Provence', owner: 'CMA CGM (Rodolphe Saadé)' },
  'tf1info.fr': { name: 'TF1 Info', owner: 'Groupe TF1 (Bouygues)' },
  'lci.fr': { name: 'LCI', owner: 'Groupe TF1 (Bouygues)' },
  'francetvinfo.fr': { name: 'Franceinfo', owner: 'Service public' },
  'france3-regions.francetvinfo.fr': { name: 'France 3 Régions', owner: 'Service public' },
  'francebleu.fr': { name: 'ici (France Bleu)', owner: 'Service public' },
  'ici.fr': { name: 'ici (France Bleu)', owner: 'Service public' },
  'franceinfo.fr': { name: 'Franceinfo', owner: 'Service public' },
  'france3-regions.franceinfo.fr': { name: 'France 3 Régions', owner: 'Service public' },
  'la1ere.franceinfo.fr': { name: 'La 1ère', owner: 'Service public' },
  'la1ere.francetvinfo.fr': { name: 'La 1ère', owner: 'Service public' },
  'arte.tv': { name: 'Arte', owner: 'Service public' },
  'lcp.fr': { name: 'LCP', owner: 'Service public (Assemblée nationale)' },
  'publicsenat.fr': { name: 'Public Sénat', owner: 'Service public (Sénat)' },
  'letelegramme.fr': { name: 'Le Télégramme', owner: 'Groupe Télégramme' },
  'la-croix.com': { name: 'La Croix', owner: 'Groupe Bayard' },
  // À vérifier : actionnariat du groupe Le Monde.
  'huffingtonpost.fr': { name: 'HuffPost', owner: 'Groupe Le Monde' },
  'nouvelobs.com': { name: "L'Obs", owner: 'Groupe Le Monde' },
  'fr.news.yahoo.com': { name: 'Yahoo Actualités', owner: 'Agrégateur (Yahoo)' },
  'actu.orange.fr': { name: 'Orange Actualités', owner: 'Agrégateur (Orange)' },
  'radiofrance.fr': { name: 'Radio France', owner: 'Service public' },
  'franceinter.fr': { name: 'France Inter', owner: 'Service public' },
  'rfi.fr': { name: 'RFI', owner: 'Service public' },
  'france24.com': { name: 'France 24', owner: 'Service public' },
  'lepoint.fr': { name: 'Le Point', owner: 'Artémis (François Pinault)' },
  'lexpress.fr': { name: "L'Express", owner: 'Alain Weill' },
  'valeursactuelles.com': { name: 'Valeurs actuelles', owner: 'Valmonde (Iskandar Safa)' },
  'nicematin.com': { name: 'Nice-Matin', owner: 'Xavier Niel' },
  'varmatin.com': { name: 'Var-Matin', owner: 'Xavier Niel' },
  'humanite.fr': { name: "L'Humanité", owner: 'Indépendant' },
  'mediapart.fr': { name: 'Mediapart', owner: 'Indépendant' },
  'reporterre.net': { name: 'Reporterre', owner: 'Indépendant' },
  'basta.media': { name: 'Basta!', owner: 'Indépendant' },
  'streetpress.com': { name: 'StreetPress', owner: 'Indépendant' },
  'blast-info.fr': { name: 'Blast', owner: 'Indépendant' },
  'ouest-france.fr': { name: 'Ouest-France', owner: 'Groupe Sipa Ouest-France' },
  'actu.fr': { name: 'Actu.fr', owner: 'Groupe Sipa Ouest-France' },
  '20minutes.fr': { name: '20 Minutes', owner: 'Rossel / Sipa Ouest-France' },
  'lavoixdunord.fr': { name: 'La Voix du Nord', owner: 'Groupe Rossel' },
  'courrier-picard.fr': { name: 'Courrier picard', owner: 'Groupe Rossel' },
  'ladepeche.fr': { name: 'La Dépêche du Midi', owner: 'Groupe La Dépêche (Baylet)' },
  'midilibre.fr': { name: 'Midi Libre', owner: 'Groupe La Dépêche (Baylet)' },
  'lindependant.fr': { name: "L'Indépendant", owner: 'Groupe La Dépêche (Baylet)' },
  'sudouest.fr': { name: 'Sud Ouest', owner: 'Groupe Sud Ouest' },
  'leprogres.fr': { name: 'Le Progrès', owner: 'EBRA (Crédit Mutuel)' },
  'ledauphine.com': { name: 'Le Dauphiné libéré', owner: 'EBRA (Crédit Mutuel)' },
  'estrepublicain.fr': { name: "L'Est républicain", owner: 'EBRA (Crédit Mutuel)' },
  'dna.fr': { name: 'DNA', owner: 'EBRA (Crédit Mutuel)' },
  'lalsace.fr': { name: "L'Alsace", owner: 'EBRA (Crédit Mutuel)' },
  'republicain-lorrain.fr': { name: 'Le Républicain lorrain', owner: 'EBRA (Crédit Mutuel)' },
  'vosgesmatin.fr': { name: 'Vosges Matin', owner: 'EBRA (Crédit Mutuel)' },
  'bienpublic.com': { name: 'Le Bien public', owner: 'EBRA (Crédit Mutuel)' },
  'lejsl.com': { name: 'Le JSL', owner: 'EBRA (Crédit Mutuel)' },
  'lanouvellerepublique.fr': { name: 'La Nouvelle République', owner: 'Groupe NR' },
}

export const UNKNOWN_OWNER = 'Non renseigné'

/** Sites régionaux d'un groupe (*.maville.com, *.ouest-france.fr) : même propriétaire. */
const FAMILIES: Array<[RegExp, string]> = [
  [/(^|\.)maville\.com$/, 'Groupe Sipa Ouest-France'],
  [/(^|\.)ouest-france\.fr$/, 'Groupe Sipa Ouest-France'],
  [/(^|\.)francetvinfo\.fr$/, 'Service public'],
]

export function outletOf(domain: string): { name: string; owner: string } {
  const d = domain.replace(/^www\./, '')
  const known = OUTLETS[d]
  if (known) return known
  const family = FAMILIES.find(([re]) => re.test(d))
  return { name: d, owner: family ? family[1] : UNKNOWN_OWNER }
}

export interface OutletStats {
  key: string
  name: string
  owner: string
  articles: number
  /** Parts (0 à 1) sur les articles qui parlent de la mobilisation. */
  demands: number
  studentVoices: number
  officialVoices: number
  incidentsFocus: number
  incidents: number
  policeViolence: number
  favorable: number
  defavorable: number
  /** Mots employés, du plus fréquent au moins fréquent. */
  terms: Array<[string, number]>
  badges: Badge[]
}

export interface Badge {
  id: string
  label: string
  tone: 'good' | 'warn' | 'poor'
  /** La règle, affichée au survol. */
  rule: string
}

/** Nombre d'articles minimal pour afficher un constat (en dessous, trop fragile). */
export const MIN_ARTICLES_BADGE = 15

/** Constats calculés par des règles simples, à partir de MIN_ARTICLES_BADGE articles. */
export function badgesFor(s: Omit<OutletStats, 'badges' | 'key'>): Badge[] {
  if (s.articles < MIN_ARTICLES_BADGE) return []
  const out: Badge[] = []
  const pct = (x: number) => `${Math.round(x * 100)} %`
  if (s.incidentsFocus >= 0.5 && s.demands <= 0.25)
    out.push({
      id: 'degats',
      label: 'Peu de revendications, surtout des incidents',
      tone: 'poor',
      rule: `Sur ${s.articles} articles : angle « incidents » dans ${pct(s.incidentsFocus)}, revendications citées dans ${pct(s.demands)} (règle : ≥ 50 % et ≤ 25 %).`,
    })
  if (s.officialVoices >= 0.5 && s.studentVoices <= 0.2)
    out.push({
      id: 'officiel',
      label: 'Surtout la parole officielle',
      tone: 'poor',
      rule: `Sur ${s.articles} articles : police, préfecture ou direction s'expriment dans ${pct(s.officialVoices)}, les lycéens dans ${pct(s.studentVoices)} (règle : ≥ 50 % et ≤ 20 %).`,
    })
  if (s.defavorable >= 0.5)
    out.push({
      id: 'hostile',
      label: 'Ton défavorable majoritaire',
      tone: 'poor',
      rule: `Sur ${s.articles} articles : ton défavorable dans ${pct(s.defavorable)} (règle : ≥ 50 %). Mesure subjective, à vérifier.`,
    })
  if (s.demands >= 0.6)
    out.push({
      id: 'revendications',
      label: 'Revendications souvent citées',
      tone: 'good',
      rule: `Sur ${s.articles} articles : revendications citées dans ${pct(s.demands)} (règle : ≥ 60 %).`,
    })
  if (s.studentVoices >= 0.5)
    out.push({
      id: 'parole',
      label: 'Parole aux lycéens fréquente',
      tone: 'good',
      rule: `Sur ${s.articles} articles : lycéens cités dans ${pct(s.studentVoices)} (règle : ≥ 50 %).`,
    })
  if (out.length === 0 && s.incidentsFocus >= 0.35)
    out.push({
      id: 'incidents',
      label: 'Penche vers les incidents',
      tone: 'warn',
      rule: `Sur ${s.articles} articles : angle « incidents » dans ${pct(s.incidentsFocus)} (règle : ≥ 35 %).`,
    })
  return out
}

const OFFICIAL = new Set(['police_prefecture', 'direction_rectorat'])

/** Regroupe par média (`by: 'outlet'`) ou par propriétaire (`by: 'owner'`). */
export function aggregate(rows: ReadonlyArray<MediaRow>, by: 'outlet' | 'owner'): OutletStats[] {
  const groups = new Map<string, MediaRow[]>()
  for (const r of rows) {
    if (!r.about_movement) continue
    const o = outletOf(r.domain)
    const key = by === 'owner' ? o.owner : r.domain.replace(/^www\./, '')
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups]
    .map(([key, list]) => {
      const n = list.length
      const share = (f: (r: MediaRow) => boolean) => list.filter(f).length / n
      const termCount = new Map<string, number>()
      for (const r of list) for (const t of r.terms) termCount.set(t, (termCount.get(t) ?? 0) + 1)
      const o = by === 'owner' ? { name: key, owner: key } : outletOf(key)
      const base = {
        name: o.name,
        owner: o.owner,
        articles: n,
        demands: share((r) => r.mentions_demands),
        studentVoices: share((r) => r.voices.includes('lyceens')),
        officialVoices: share((r) => r.voices.some((v) => OFFICIAL.has(v))),
        incidentsFocus: share((r) => r.focus === 'incidents'),
        incidents: share((r) => r.incidents),
        policeViolence: share((r) => r.police_violence),
        favorable: share((r) => r.tone === 'favorable'),
        defavorable: share((r) => r.tone === 'defavorable'),
        terms: [...termCount].sort((a, b) => b[1] - a[1]),
      }
      return { key, ...base, badges: badgesFor(base) }
    })
    .sort(
      (a, b) =>
        Number(a.owner === UNKNOWN_OWNER && by === 'owner') -
          Number(b.owner === UNKNOWN_OWNER && by === 'owner') ||
        b.articles - a.articles ||
        a.name.localeCompare(b.name, 'fr'),
    )
}

/** Revendications les plus citées, toutes sources confondues. */
export function topDemands(rows: ReadonlyArray<MediaRow>, limit = 12): Array<[string, number]> {
  const count = new Map<string, number>()
  for (const r of rows) {
    if (!r.about_movement) continue
    for (const d of new Set(r.demands.map((x) => x.toLowerCase().trim()))) {
      if (d) count.set(d, (count.get(d) ?? 0) + 1)
    }
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, limit)
}
