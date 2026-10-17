import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { AdminShell } from '@/components/admin/AdminShell'
import { AiUsagePanel } from '@/components/admin/AiUsagePanel'
import { AuditPanel } from '@/components/admin/AuditPanel'
import { EnrollTotp } from '@/components/admin/EnrollTotp'
import { JudgePanel } from '@/components/admin/JudgePanel'
import { LoginForm } from '@/components/admin/LoginForm'
import { MediaPanel } from '@/components/admin/MediaPanel'
import { MovementsPanel } from '@/components/admin/MovementsPanel'
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
import { TABS, visibleTab, type Tab } from '@/lib/adminTabs'
import {
  twoFactorPolicyQuery,
  useSession,
  useSignOut,
} from '@/queries/admin'

export const Route = createFileRoute('/admin')({
  validateSearch: z.object({ tab: z.enum(TABS).catch('moderation') }),
  component: AdminPage,
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
})

function AdminPage() {
  const session = useSession()
  const twoFactorPolicy = useQuery(twoFactorPolicyQuery)
  const signOut = useSignOut()
  const search = Route.useSearch()

  if (session.isPending || twoFactorPolicy.isPending)
    return <div className="flex-1 animate-pulse bg-surface" />
  const user = session.data
  if (!user) return <LoginForm />
  // The server refuses an admin without a second factor when the policy requires it.
  if (twoFactorPolicy.data?.required && user.role === 'admin' && !user.twoFactorEnabled)
    return <EnrollTotp />

  const moderator = user.role === 'moderator'
  const tab: Tab = visibleTab(user.role, search.tab)

  return (
    <AdminShell user={user} tab={tab} onSignOut={() => void signOut()}>
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'moderation' && <PendingPanel role={user.role} />}
      {tab === 'lycees' && <ProposalsPanel canReject={!moderator} />}
      {tab === 'non-rattaches' && <UnmatchedPanel canManage={!moderator} />}
      {tab === 'signaux' && <ReportsPanel />}
      {tab === 'sources' && <SourcesPanel />}
      {tab === 'domaines' && <TrustedDomainsPanel />}
      {tab === 'mouvements' && <MovementsPanel />}
      {tab === 'stats' && <StatsPanel />}
      {tab === 'ia' && <AiUsagePanel />}
      {tab === 'medias' && <MediaPanel />}
      {tab === 'tweets' && <TweetsPanel />}
      {tab === 'juge' && <JudgePanel />}
      {tab === 'reglages' && <SettingsPanel />}
      {tab === 'journal' && <AuditPanel />}
      {tab === 'equipe' && <TeamPanel selfId={user.id} />}
    </AdminShell>
  )
}
