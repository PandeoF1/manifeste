import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { AiUsagePanel } from '@/components/admin/AiUsagePanel'
import { AuditPanel } from '@/components/admin/AuditPanel'
import { EnrollTotp } from '@/components/admin/EnrollTotp'
import { JudgePanel } from '@/components/admin/JudgePanel'
import { LoginForm } from '@/components/admin/LoginForm'
import { MediaPanel } from '@/components/admin/MediaPanel'
import { PendingPanel } from '@/components/admin/PendingPanel'
import { PipelineTab } from '@/components/admin/pipeline/PipelineTab'
import { ProposalsPanel } from '@/components/admin/ProposalsPanel'
import { ReportsPanel } from '@/components/admin/ReportsPanel'
import { SettingsPanel } from '@/components/admin/SettingsPanel'
import { SourcesPanel } from '@/components/admin/SourcesPanel'
import { StatsPanel } from '@/components/admin/StatsPanel'
import { TeamPanel } from '@/components/admin/TeamPanel'
import { TweetsPanel } from '@/components/admin/TweetsPanel'
import { TrustedDomainsPanel } from '@/components/admin/TrustedDomainsPanel'
import { UnmatchedPanel } from '@/components/admin/UnmatchedPanel'
import { TABS, TAB_LABELS, tabsFor, visibleTab, type Tab } from '@/lib/adminTabs'
import { pendingQuery, proposalsQuery, useSession, useSignOut } from '@/queries/admin'

export const Route = createFileRoute('/admin')({
  validateSearch: z.object({ tab: z.enum(TABS).catch('pipeline') }),
  component: AdminPage,
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
})

function AdminPage() {
  const session = useSession()
  const signOut = useSignOut()
  const search = Route.useSearch()

  if (session.isPending) return <div className="flex-1 animate-pulse bg-surface" />
  const user = session.data
  if (!user) return <LoginForm />
  // The server refuses an admin without a second factor on every call: ask for it first.
  if (user.role === 'admin' && !user.twoFactorEnabled) return <EnrollTotp />

  const moderator = user.role === 'moderator'
  const tabs = tabsFor(user.role)
  const tab: Tab = visibleTab(
    user.role,
    search.tab === 'pipeline' && moderator ? 'moderation' : search.tab,
  )

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{moderator ? 'Modération' : 'Administration'}</h1>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline">{user.email}</span>
          <button type="button" className="btn-secondary" onClick={() => void signOut()}>
            Se déconnecter
          </button>
        </div>
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
            {t === 'moderation' && <Count query={pendingQuery} />}
            {t === 'lycees' && <Count query={proposalsQuery} />}
          </Link>
        ))}
      </nav>
      <div className="mt-4">
        {tab === 'pipeline' && <PipelineTab />}
        {tab === 'moderation' && <PendingPanel role={user.role} />}
        {tab === 'lycees' && <ProposalsPanel canReject={!moderator} />}
        {tab === 'non-rattaches' && <UnmatchedPanel canManage={!moderator} />}
        {tab === 'signaux' && <ReportsPanel />}
        {tab === 'sources' && <SourcesPanel />}
        {tab === 'domaines' && <TrustedDomainsPanel />}
        {tab === 'stats' && <StatsPanel />}
        {tab === 'ia' && <AiUsagePanel />}
        {tab === 'medias' && <MediaPanel />}
        {tab === 'tweets' && <TweetsPanel />}
        {tab === 'juge' && <JudgePanel />}
        {tab === 'reglages' && <SettingsPanel />}
        {tab === 'journal' && <AuditPanel />}
        {tab === 'equipe' && <TeamPanel selfId={user.id} />}
      </div>
    </main>
  )
}

function Count({ query }: { query: typeof pendingQuery | typeof proposalsQuery }) {
  const { data } = useQuery(query as typeof pendingQuery)
  if (!data?.length) return null
  return <span className="ml-1 rounded-full bg-bloque px-2 text-xs text-white">{data.length}</span>
}
