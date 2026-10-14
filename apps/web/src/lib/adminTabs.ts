import type { StaffRole } from './auth'

export const TABS = [
  'pipeline',
  'moderation',
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
  moderation: 'Modération',
  lycees: 'Établissements proposés',
  'non-rattaches': 'Non rattachés',
  signaux: 'Signalements',
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

/** What a moderator sees: validate, handle proposed schools and unmatched facts, read stats and media. */
const MODERATOR_TABS: readonly Tab[] = ['moderation', 'lycees', 'non-rattaches', 'stats', 'medias']

/** The tabs of a role, in display order. The server enforces the same rules on every call. */
export const tabsFor = (role: StaffRole): readonly Tab[] =>
  role === 'admin' ? TABS : MODERATOR_TABS

/** The tab to show: the one asked for if the role may see it, else the role's first. */
export function visibleTab(role: StaffRole, asked: Tab): Tab {
  const tabs = tabsFor(role)
  return tabs.includes(asked) ? asked : (tabs[0] as Tab)
}
