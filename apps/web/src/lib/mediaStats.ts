// Admin "Media" tab: aggregates article analyses by outlet and by owner,
// and findings computed by explicit rules (not by the AI).

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
  /** Length of the text the AI read; null for analyses before this was measured. */
  text_chars?: number | null
}

/**
 * Below this, the AI only saw a title or a short standfirst (paywalled articles, radio flashes): we cannot
 * tell whether the demands are presented or who speaks. Otherwise outlets that
 * give little text would be unfairly penalised.
 */
export const MIN_TEXT_CHARS = 500
const readable = (r: MediaRow) => r.text_chars == null || r.text_chars >= MIN_TEXT_CHARS

/**
 * Outlet and owner. Checked on the web on 6 October 2026 (CB News, The Media Leader,
 * Autorité de la concurrence, group press releases); domains not listed are shown as is,
 * owner "Non renseigné". Ownership percentages are deliberately
 * not shown: several are not public or are dated.
 * To watch (may change): Sud Ouest (Rossel in exclusive negotiation for 80%, end
 * 2026), 20 Minutes (Rossel at 100% announced in February 2026, closing not confirmed), Le
 * Parisien (sale rumour denied by LVMH), public broadcasting holding.
 */
export const OUTLETS: Record<string, { name: string; owner: string }> = {
  // National press
  'lemonde.fr': {
    name: 'Le Monde',
    owner: "Groupe Le Monde (Fonds pour l'indépendance de la presse)",
  },
  'huffingtonpost.fr': {
    name: 'HuffPost',
    owner: "Groupe Le Monde (Fonds pour l'indépendance de la presse)",
  },
  'nouvelobs.com': {
    name: "L'Obs",
    owner: "Groupe Le Monde (Fonds pour l'indépendance de la presse)",
  },
  'lefigaro.fr': { name: 'Le Figaro', owner: 'Groupe Dassault' },
  'liberation.fr': { name: 'Libération', owner: 'Presse indépendante (fonds de dotation)' },
  'leparisien.fr': { name: 'Le Parisien', owner: 'LVMH (Bernard Arnault)' },
  'lesechos.fr': { name: 'Les Échos', owner: 'LVMH (Bernard Arnault)' },
  'lopinion.fr': { name: "L'Opinion", owner: 'LVMH (Bernard Arnault)' },
  'cnews.fr': { name: 'CNews', owner: 'Groupe Canal+ (Bolloré)' },
  'europe1.fr': { name: 'Europe 1', owner: 'Lagardère / Louis Hachette Group (Bolloré)' },
  'lejdd.fr': { name: 'Le JDD', owner: 'Lagardère / Louis Hachette Group (Bolloré)' },
  'bfmtv.com': { name: 'BFMTV', owner: 'CMA CGM (Rodolphe Saadé)' },
  'rmc.bfmtv.com': { name: 'RMC', owner: 'CMA CGM (Rodolphe Saadé)' },
  'tf1info.fr': { name: 'TF1 Info', owner: 'Groupe TF1 (Bouygues)' },
  'lci.fr': { name: 'LCI', owner: 'Groupe TF1 (Bouygues)' },
  'rtl.fr': { name: 'RTL', owner: 'Groupe M6 (RTL Group / Bertelsmann)' },
  'sudradio.fr': { name: 'Sud Radio', owner: 'Fiducial' },
  'lepoint.fr': { name: 'Le Point', owner: 'Artémis (François Pinault)' },
  'lexpress.fr': { name: "L'Express", owner: 'Alain Weill' },
  'marianne.net': { name: 'Marianne', owner: 'CMI France (Daniel Kretinsky)' },
  'valeursactuelles.com': {
    name: 'Valeurs actuelles',
    owner: 'Valmonde (La Combe, Caude, Stérin)',
  },
  '20minutes.fr': { name: '20 Minutes', owner: 'Groupe Rossel' },
  'la-croix.com': { name: 'La Croix', owner: 'Groupe Bayard (Assomptionnistes)' },
  'mariefrance.fr': { name: 'Marie France', owner: 'Reworld Media' },
  'aufeminin.com': { name: 'Aufeminin', owner: 'Reworld Media' },
  'boursorama.com': { name: 'Boursorama', owner: 'Société Générale' },
  'jeanmarcmorandini.com': {
    name: 'Jean-Marc Morandini',
    owner: 'The Web Family (J.-M. Morandini)',
  },
  'fr.news.yahoo.com': { name: 'Yahoo Actualités', owner: 'Agrégateur (Yahoo)' },
  'actu.orange.fr': { name: 'Orange Actualités', owner: 'Agrégateur (Orange)' },

  // Independents, associations, funds
  'humanite.fr': { name: "L'Humanité", owner: "L'Humanité (PCF, lecteurs, salariés)" },
  'mediapart.fr': { name: 'Mediapart', owner: 'Fonds pour une presse libre' },
  'reporterre.net': { name: 'Reporterre', owner: 'Association La Pile' },
  'basta.media': { name: 'Basta!', owner: 'Association Alter-médias' },
  'streetpress.com': { name: 'StreetPress', owner: 'Indépendant' },
  'blast-info.fr': { name: 'Blast', owner: 'Indépendant' },

  // Service public
  'francetvinfo.fr': { name: 'Franceinfo', owner: 'Service public' },
  'franceinfo.fr': { name: 'Franceinfo', owner: 'Service public' },
  'france3-regions.francetvinfo.fr': { name: 'France 3 Régions', owner: 'Service public' },
  'france3-regions.franceinfo.fr': { name: 'France 3 Régions', owner: 'Service public' },
  'la1ere.franceinfo.fr': { name: 'La 1ère', owner: 'Service public' },
  'la1ere.francetvinfo.fr': { name: 'La 1ère', owner: 'Service public' },
  'francebleu.fr': { name: 'ici (France Bleu)', owner: 'Service public' },
  'ici.fr': { name: 'ici (France Bleu)', owner: 'Service public' },
  'radiofrance.fr': { name: 'Radio France', owner: 'Service public' },
  'franceinter.fr': { name: 'France Inter', owner: 'Service public' },
  'rfi.fr': { name: 'RFI', owner: 'Service public' },
  'france24.com': { name: 'France 24', owner: 'Service public' },
  'arte.tv': { name: 'Arte', owner: 'Service public' },
  'lcp.fr': { name: 'LCP', owner: 'Service public (Assemblée nationale)' },
  'publicsenat.fr': { name: 'Public Sénat', owner: 'Service public (Sénat)' },

  // Regional press
  'ouest-france.fr': { name: 'Ouest-France', owner: 'Groupe Sipa Ouest-France' },
  'actu.fr': { name: 'Actu.fr', owner: 'Groupe Sipa Ouest-France' },
  'hitwest.ouest-france.fr': { name: 'Hit West', owner: 'Groupe 1981' },
  'lavoixdunord.fr': { name: 'La Voix du Nord', owner: 'Groupe Rossel' },
  'courrier-picard.fr': { name: 'Courrier picard', owner: 'Groupe Rossel' },
  'lest-eclair.fr': { name: "L'Est-Éclair", owner: 'Groupe Rossel' },
  'ladepeche.fr': { name: 'La Dépêche du Midi', owner: 'Groupe La Dépêche (Baylet)' },
  'midilibre.fr': { name: 'Midi Libre', owner: 'Groupe La Dépêche (Baylet)' },
  'lindependant.fr': { name: "L'Indépendant", owner: 'Groupe La Dépêche (Baylet)' },
  'nrpyrenees.fr': {
    name: 'La Nouvelle République des Pyrénées',
    owner: 'Groupe La Dépêche (Baylet)',
  },
  'centrepresseaveyron.fr': { name: 'Centre Presse Aveyron', owner: 'Groupe La Dépêche (Baylet)' },
  'sudouest.fr': { name: 'Sud Ouest', owner: 'Groupe Sud Ouest' },
  'charentelibre.fr': { name: 'Charente Libre', owner: 'Groupe Sud Ouest' },
  'dordognelibre.fr': { name: 'Dordogne Libre', owner: 'Groupe Sud Ouest' },
  'larepubliquedespyrenees.fr': { name: 'La République des Pyrénées', owner: 'Groupe Sud Ouest' },
  'lamontagne.fr': { name: 'La Montagne', owner: 'Groupe Centre France (Fondation Varenne)' },
  'larep.fr': {
    name: 'La République du Centre',
    owner: 'Groupe Centre France (Fondation Varenne)',
  },
  'lechorepublicain.fr': {
    name: "L'Écho républicain",
    owner: 'Groupe Centre France (Fondation Varenne)',
  },
  'lyonne.fr': { name: "L'Yonne républicaine", owner: 'Groupe Centre France (Fondation Varenne)' },
  'lanouvellerepublique.fr': { name: 'La Nouvelle République', owner: 'Groupe NR' },
  'leprogres.fr': { name: 'Le Progrès', owner: 'EBRA (Crédit Mutuel)' },
  'ledauphine.com': { name: 'Le Dauphiné libéré', owner: 'EBRA (Crédit Mutuel)' },
  'estrepublicain.fr': { name: "L'Est républicain", owner: 'EBRA (Crédit Mutuel)' },
  'dna.fr': { name: 'DNA', owner: 'EBRA (Crédit Mutuel)' },
  'lalsace.fr': { name: "L'Alsace", owner: 'EBRA (Crédit Mutuel)' },
  'republicain-lorrain.fr': { name: 'Le Républicain lorrain', owner: 'EBRA (Crédit Mutuel)' },
  'vosgesmatin.fr': { name: 'Vosges Matin', owner: 'EBRA (Crédit Mutuel)' },
  'bienpublic.com': { name: 'Le Bien public', owner: 'EBRA (Crédit Mutuel)' },
  'lejsl.com': { name: 'Le JSL', owner: 'EBRA (Crédit Mutuel)' },
  'letelegramme.fr': { name: 'Le Télégramme', owner: 'ADVENN (ex-Groupe Télégramme)' },
  'laprovence.com': { name: 'La Provence', owner: 'CMA CGM (Rodolphe Saadé)' },
  'corsematin.com': { name: 'Corse-Matin', owner: 'CMA CGM (Rodolphe Saadé)' },
  'nicematin.com': { name: 'Nice-Matin', owner: 'Xavier Niel' },
  'varmatin.com': { name: 'Var-Matin', owner: 'Xavier Niel' },
  'franceguyane.fr': { name: 'France-Guyane', owner: 'Xavier Niel' },
  'guadeloupe.franceantilles.fr': { name: 'France-Antilles Guadeloupe', owner: 'Xavier Niel' },
}

export const UNKNOWN_OWNER = 'Non renseigné'

/** A group's regional sites (*.maville.com, *.ouest-france.fr): same owner. */
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
  /** Shares (0 to 1) of the articles that talk about the mobilisation. */
  demands: number
  /** Articles on which `demands` and speakers are computed (enough text read). */
  demandsBase: number
  studentVoices: number
  officialVoices: number
  incidentsFocus: number
  incidents: number
  policeViolence: number
  favorable: number
  defavorable: number
  /** Words used, from most to least frequent. */
  terms: Array<[string, number]>
  badges: Badge[]
}

export interface Badge {
  id: string
  label: string
  tone: 'good' | 'warn' | 'poor'
  /** The rule, shown on hover. */
  rule: string
}

/** Minimum number of articles to show a finding (below, too fragile). */
export const MIN_ARTICLES_BADGE = 15

/** Findings computed by simple rules, from MIN_ARTICLES_BADGE articles. */
export function badgesFor(s: Omit<OutletStats, 'badges' | 'key'>): Badge[] {
  if (s.articles < MIN_ARTICLES_BADGE) return []
  const out: Badge[] = []
  const pct = (x: number) => `${Math.round(x * 100)} %`
  const textKnown = s.demandsBase >= MIN_ARTICLES_BADGE
  if (textKnown && s.incidentsFocus >= 0.5 && s.demands <= 0.25)
    out.push({
      id: 'degats',
      label: 'Peu de revendications, surtout des incidents',
      tone: 'poor',
      rule: `Sur ${s.articles} articles : angle « incidents » dans ${pct(s.incidentsFocus)}, revendications citées dans ${pct(s.demands)} des ${s.demandsBase} dont l'IA a lu au moins ${MIN_TEXT_CHARS} caractères (règle : ≥ 50 % et ≤ 25 %).`,
    })
  if (textKnown && s.officialVoices >= 0.5 && s.studentVoices <= 0.2)
    out.push({
      id: 'officiel',
      label: 'Surtout la parole officielle',
      tone: 'poor',
      rule: `Sur ${s.demandsBase} articles dont l'IA a lu au moins ${MIN_TEXT_CHARS} caractères : police, préfecture ou direction s'expriment dans ${pct(s.officialVoices)}, les lycéens dans ${pct(s.studentVoices)} (règle : ≥ 50 % et ≤ 20 %).`,
    })
  if (textKnown && s.demands >= 0.6)
    out.push({
      id: 'revendications',
      label: 'Revendications souvent citées',
      tone: 'good',
      rule: `Sur ${s.demandsBase} articles dont l'IA a lu au moins ${MIN_TEXT_CHARS} caractères : revendications citées dans ${pct(s.demands)} (règle : ≥ 60 %).`,
    })
  if (textKnown && s.studentVoices >= 0.5)
    out.push({
      id: 'parole',
      label: 'Parole aux lycéens fréquente',
      tone: 'good',
      rule: `Sur ${s.demandsBase} articles dont l'IA a lu au moins ${MIN_TEXT_CHARS} caractères : lycéens cités dans ${pct(s.studentVoices)} (règle : ≥ 50 %).`,
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

/** Groups by outlet (`by: 'outlet'`) or by owner (`by: 'owner'`). */
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
      const readableList = list.filter(readable)
      const shareRead = (f: (r: MediaRow) => boolean) =>
        readableList.length ? readableList.filter(f).length / readableList.length : 0
      const termCount = new Map<string, number>()
      for (const r of list) for (const t of r.terms) termCount.set(t, (termCount.get(t) ?? 0) + 1)
      const o = by === 'owner' ? { name: key, owner: key } : outletOf(key)
      const base = {
        name: o.name,
        owner: o.owner,
        articles: n,
        demands: readableList.length
          ? readableList.filter((r) => r.mentions_demands).length / readableList.length
          : 0,
        demandsBase: readableList.length,
        studentVoices: shareRead((r) => r.voices.includes('lyceens')),
        officialVoices: shareRead((r) => r.voices.some((v) => OFFICIAL.has(v))),
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

/** Most cited demands, all sources combined. */
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

/** One analysis as the API sends it (camelCase, English values). */
export interface ApiMediaRow {
  url: string
  domain: string
  title: string | null
  publishedAt: Date | null
  aboutMovement: boolean
  mentionsDemands: boolean
  demands: string[]
  voices: string[]
  focus: string
  incidents: boolean
  policeViolence: boolean
  terms: string[]
  tone: string
  quoteDemands: string | null
  quoteFraming: string | null
  textChars: number | null
}

const FOCUS_FROM_API: Record<string, MediaRow['focus']> = {
  demands: 'revendications',
  mobilisation: 'mobilisation',
  incidents: 'incidents',
  mixed: 'mixte',
}
const TONE_FROM_API: Record<string, MediaRow['tone']> = {
  favourable: 'favorable',
  neutral: 'neutre',
  unfavourable: 'defavorable',
}
const VOICE_FROM_API: Record<string, string> = {
  students: 'lyceens',
  teachers_unions: 'enseignants_syndicats',
  parents: 'parents',
  school_authorities: 'direction_rectorat',
  police_prefecture: 'police_prefecture',
  politicians: 'politiques',
}

/** The statistics and the exports keep their French vocabulary: this is the only place that translates. */
export function fromApiMedia(r: ApiMediaRow): MediaRow {
  return {
    url: r.url,
    domain: r.domain,
    title: r.title,
    published_at: r.publishedAt ? r.publishedAt.toISOString() : null,
    about_movement: r.aboutMovement,
    mentions_demands: r.mentionsDemands,
    demands: r.demands,
    voices: r.voices.map((v) => VOICE_FROM_API[v] ?? v),
    focus: FOCUS_FROM_API[r.focus] ?? 'mixte',
    incidents: r.incidents,
    police_violence: r.policeViolence,
    terms: r.terms,
    tone: TONE_FROM_API[r.tone] ?? 'neutre',
    quote_demands: r.quoteDemands,
    quote_framing: r.quoteFraming,
    text_chars: r.textChars,
  }
}
