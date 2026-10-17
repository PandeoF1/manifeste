import type { StaffRole } from './auth'

export const TABS = [
  'pipeline',
  'moderation',
  'mouvements',
  'parcours',
  'lycees',
  'non-rattaches',
  'signaux',
  'sources',
  'domaines',
  'stats',
  'ia',
  'medias',
  'tweets',
  'juge',
  'reglages',
  'journal',
  'equipe',
] as const
export type Tab = (typeof TABS)[number]

export const TAB_LABELS: Record<Tab, string> = {
  pipeline: 'Pipeline',
  moderation: 'À valider',
  mouvements: 'Mouvements',
  parcours: 'Parcours détectés',
  lycees: 'Établissements proposés',
  'non-rattaches': 'Non rattachés',
  signaux: 'Tous les signalements',
  sources: 'Sources',
  domaines: 'Domaines de confiance',
  stats: 'Stats',
  ia: 'IA',
  medias: 'Médias',
  tweets: 'Tweets',
  juge: 'Juge',
  reglages: 'Réglages',
  journal: 'Journal',
  equipe: 'Équipe',
}

/** One line under each page title: what the page is for. */
export const TAB_HINTS: Record<Tab, string> = {
  moderation: 'Les signalements en attente : valide-les ou rejette-les.',
  lycees: 'Les établissements proposés par les visiteurs, à ajouter à la carte.',
  'non-rattaches': 'Les faits lus par l’IA dont l’établissement n’a pas été reconnu.',
  signaux: 'Tous les signalements publiés : corrige-les ou masque-les.',
  pipeline: 'La collecte en direct : étapes, files d’attente, erreurs.',
  sources: 'Les flux, comptes et canaux lus automatiquement.',
  domaines: 'Les médias dont les articles sont publiés sans modération.',
  mouvements:
    'Les campagnes, leurs cortèges et leurs parcours. Archiver garde la page, la carte et les données.',
  parcours:
    'Les cortèges trouvés dans la presse, à vérifier sur la carte avant de les publier. Rien n’est public sans toi.',
  stats: 'La fréquentation du site, sans suivi individuel.',
  medias: 'Comment les médias traitent le mouvement.',
  tweets: 'Générer les visuels et textes à publier.',
  ia: 'Consommation et coût des appels d’IA.',
  juge: 'Le second avis sur les signalements.',
  reglages: 'Les réglages du site.',
  journal: 'Qui a fait quoi, et quand.',
  equipe: 'Les comptes de l’équipe.',
}

export interface TabGroup {
  id: string
  label: string
  tabs: readonly Tab[]
}

/** The sidebar: every tab appears in exactly one group (a test checks it). */
export const TAB_GROUPS: readonly TabGroup[] = [
  {
    id: 'moderation',
    label: 'Modération',
    tabs: ['moderation', 'lycees', 'non-rattaches', 'signaux'],
  },
  { id: 'collecte', label: 'Collecte', tabs: ['pipeline', 'sources', 'domaines'] },
  { id: 'contenu', label: 'Contenu', tabs: ['mouvements', 'parcours'] },
  { id: 'analyse', label: 'Analyse', tabs: ['stats', 'medias', 'tweets'] },
  { id: 'ia', label: 'IA', tabs: ['ia', 'juge'] },
  { id: 'systeme', label: 'Système', tabs: ['reglages', 'journal', 'equipe'] },
]

/** What a moderator sees: validate, handle proposed schools and unmatched facts, read stats and media. */
const MODERATOR_TABS: readonly Tab[] = ['moderation', 'lycees', 'non-rattaches', 'stats', 'medias']

/** The tabs of a role, in display order. The server enforces the same rules on every call. */
export const tabsFor = (role: StaffRole): readonly Tab[] =>
  role === 'admin' ? TABS : MODERATOR_TABS

/** The sidebar groups of a role: only the tabs it may see, and no empty group. */
export const groupsFor = (role: StaffRole): TabGroup[] => {
  const allowed = tabsFor(role)
  return TAB_GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((t) => allowed.includes(t)) })).filter(
    (g) => g.tabs.length > 0,
  )
}

/** The tab to show: the one asked for if the role may see it, else the role's first. */
export function visibleTab(role: StaffRole, asked: Tab): Tab {
  const tabs = tabsFor(role)
  return tabs.includes(asked) ? asked : (tabs[0] as Tab)
}
