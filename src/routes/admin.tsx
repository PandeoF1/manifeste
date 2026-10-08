import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { LoginForm } from '@/components/admin/LoginForm'
import { MediaPanel } from '@/components/admin/MediaPanel'
import { PendingPanel } from '@/components/admin/PendingPanel'
import { ProposalsPanel, proposalsQuery } from '@/components/admin/ProposalsPanel'
import { ReportsPanel } from '@/components/admin/ReportsPanel'
import { SettingsPanel } from '@/components/admin/SettingsPanel'
import { SourcesPanel } from '@/components/admin/SourcesPanel'
import { StatsPanel } from '@/components/admin/StatsPanel'
import { TrustedDomainsPanel } from '@/components/admin/TrustedDomainsPanel'
import { UnmatchedPanel } from '@/components/admin/UnmatchedPanel'
import { supabase } from '@/lib/supabase'
import { pendingQueryFor, staffRole, useSession } from '@/queries/admin'

const TABS = [
  'sources',
  'moderation',
  'lycees',
  'signaux',
  'non-rattaches',
  'domaines',
  'stats',
  'medias',
  'reglages',
] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  sources: 'Sources',
  moderation: 'Modération',
  lycees: 'Établissements proposés',
  signaux: 'Signaux',
  'non-rattaches': 'Non rattachés',
  domaines: 'Domaines de confiance',
  stats: 'Stats',
  medias: 'Médias',
  reglages: 'Réglages',
}

export const Route = createFileRoute('/admin')({
  validateSearch: z.object({ tab: z.enum(TABS).catch('sources') }),
  component: AdminPage,
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
})

/** Onglets d'un modérateur : valider, traiter les établissements proposés, lire stats et médias. */
const MODERATOR_TABS: readonly Tab[] = ['moderation', 'lycees', 'non-rattaches', 'stats', 'medias']

function AdminPage() {
  const session = useSession()
  const search = Route.useSearch()

  if (session.isPending) return <div className="flex-1 animate-pulse bg-surface" />
  if (!session.data) return <LoginForm />
  const role = staffRole(session.data)
  if (!role) {
    return (
      <main className="p-6">
        <p>Ce compte n'a pas accès à l'administration.</p>
        <button
          type="button"
          className="btn-secondary mt-3"
          onClick={() => void supabase.auth.signOut()}
        >
          Se déconnecter
        </button>
      </main>
    )
  }

  const moderator = role === 'moderator'
  const tabs = moderator ? MODERATOR_TABS : TABS
  const tab: Tab = moderator && !tabs.includes(search.tab) ? 'moderation' : search.tab

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{moderator ? 'Modération' : 'Administration'}</h1>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void supabase.auth.signOut()}
        >
          Se déconnecter
        </button>
      </div>
      <nav aria-label="Sections" className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <Link
            key={t}
            to="/admin"
            search={{ tab: t }}
            className="min-h-12 whitespace-nowrap px-3 py-3 text-sm"
            activeOptions={{ includeSearch: true }}
            activeProps={{
              className: 'border-b-2 border-accent font-semibold',
              'aria-current': 'page',
            }}
          >
            {TAB_LABELS[t]}
            {t === 'moderation' && <PendingCount moderator={moderator} />}
            {t === 'lycees' && <ProposalCount />}
          </Link>
        ))}
      </nav>
      <div className="mt-4">
        {tab === 'sources' && <SourcesPanel />}
        {tab === 'moderation' && <PendingPanel role={role} />}
        {tab === 'lycees' && <ProposalsPanel canReject={!moderator} />}
        {tab === 'signaux' && <ReportsPanel />}
        {tab === 'non-rattaches' && <UnmatchedPanel canManage={!moderator} />}
        {tab === 'domaines' && <TrustedDomainsPanel />}
        {tab === 'stats' && <StatsPanel />}
        {tab === 'medias' && <MediaPanel />}
        {tab === 'reglages' && <SettingsPanel />}
      </div>
    </main>
  )
}

function PendingCount({ moderator }: { moderator: boolean }) {
  const { data } = useQuery(pendingQueryFor(moderator))
  if (!data?.length) return null
  return <span className="ml-1 rounded-full bg-bloque px-2 text-xs text-white">{data.length}</span>
}

function ProposalCount() {
  const { data } = useQuery(proposalsQuery)
  if (!data?.length) return null
  return <span className="ml-1 rounded-full bg-bloque px-2 text-xs text-white">{data.length}</span>
}
