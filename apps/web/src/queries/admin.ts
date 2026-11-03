/** Every call the admin makes, typed against the server. Queries here, actions as plain functions. */
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, expectOk, reviveDates, unwrap } from '@/lib/api'
import { authClient, staffUser, type StaffSessionUser } from '@/lib/auth'
import { queryKeys } from '@/lib/queryKeys'

// --- Session --------------------------------------------------------------------------------

export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: async (): Promise<StaffSessionUser | null> => {
    const { data } = await authClient.getSession()
    return staffUser(data?.user)
  },
  staleTime: 5 * 60_000,
  retry: false,
})

export function useSession() {
  return useQuery(sessionQuery)
}

export const twoFactorPolicyQuery = queryOptions({
  queryKey: queryKeys.admin.twoFactorPolicy(),
  queryFn: async (): Promise<{ required: boolean }> => {
    const response = await fetch(`${window.location.origin}/api/staff/2fa-policy`, {
      credentials: 'include',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  },
  staleTime: 5 * 60_000,
  retry: false,
})

export function useSignOut() {
  const queryClient = useQueryClient()
  return async () => {
    await authClient.signOut()
    queryClient.setQueryData(queryKeys.session, null)
    queryClient.removeQueries({ queryKey: queryKeys.admin.all })
  }
}

// --- Moderation ---------------------------------------------------------------------------------

const staff = api.api.staff

export const pendingQuery = queryOptions({
  queryKey: queryKeys.admin.pending(),
  queryFn: () => unwrap(staff.reports.pending.get()),
  refetchInterval: 60_000,
})
export type PendingReport = Awaited<
  ReturnType<NonNullable<(typeof pendingQuery)['queryFn']>>
>[number]

export const reportsQuery = (
  filter: { q?: string; moderation?: 'pending' | 'approved' | 'rejected' } = {},
) =>
  queryOptions({
    queryKey: [...queryKeys.admin.reports(), filter],
    queryFn: () => unwrap(staff.reports.get({ query: { ...filter, limit: 300 } })),
  })
export type AdminReport = Awaited<
  ReturnType<NonNullable<ReturnType<typeof reportsQuery>['queryFn']>>
>[number]

export const decideReport = async (id: string, decision: 'approve' | 'reject', photo?: Blob) =>
  unwrap(
    staff.reports({ id }).decision.post({
      decision,
      ...(photo && { photo: new File([photo], 'photo.jpg', { type: photo.type || 'image/jpeg' }) }),
    }),
  )

export const originalPhotoUrl = (id: string) => `/api/staff/reports/${id}/original-photo`

export const updateReport = (
  id: string,
  patch: {
    schoolUai?: string
    status?: 'blocked' | 'filtering' | 'lifted'
    observedAt?: Date
    moderation?: 'pending' | 'approved' | 'rejected'
  },
) => unwrap(staff.reports({ id }).patch(patch))
export const setHidden = (id: string, hidden: boolean) =>
  unwrap(staff.reports({ id }).hidden.post({ hidden }))
export const deleteReport = async (id: string) =>
  void (await unwrap(staff.reports({ id }).delete()).catch(() => null))
export const reportToUnmatched = (id: string) =>
  unwrap(staff.reports({ id })['to-unmatched'].post())

// --- Unmatched facts and proposed schools -------------------------------------------------------------

export const unmatchedQuery = queryOptions({
  queryKey: queryKeys.admin.unmatched(),
  queryFn: () => unwrap(staff.unmatched.get()),
  refetchInterval: 60_000,
})
export type Unmatched = Awaited<ReturnType<NonNullable<(typeof unmatchedQuery)['queryFn']>>>[number]
export const candidatesQuery = (id: string) =>
  queryOptions({
    queryKey: [...queryKeys.admin.unmatched(), id, 'candidates'],
    queryFn: () => unwrap(staff.unmatched({ id }).candidates.get()),
  })
export const linkUnmatched = (id: string, uai: string) =>
  unwrap(staff.unmatched({ id }).link.post({ uai }))
export const dismissUnmatched = (id: string) => unwrap(staff.unmatched({ id }).dismiss.post())

export const proposalsQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'proposals'],
  queryFn: () => unwrap(staff.proposals.get()),
  refetchInterval: 60_000,
})
export type Proposal = Awaited<ReturnType<NonNullable<(typeof proposalsQuery)['queryFn']>>>[number]
export const resolveProposal = (
  id: string,
  body: { linkUai?: string; name?: string; city?: string; newUai?: string },
) => unwrap(staff.proposals({ id }).resolve.post(body))
export const rejectProposal = (id: string) => expectOk(staff.proposals({ id }).delete())
export const proposalPhotoUrl = (id: string) => `/api/staff/proposals/${id}/photo`

// --- Sources and trust ------------------------------------------------------------------------

export const sourcesQuery = queryOptions({
  queryKey: queryKeys.admin.sources(),
  queryFn: () => unwrap(staff.sources.get()),
  refetchInterval: 30_000,
})
export type Source = Awaited<ReturnType<NonNullable<(typeof sourcesQuery)['queryFn']>>>[number]
export const presetsQuery = queryOptions({
  queryKey: [...queryKeys.admin.sources(), 'presets'],
  queryFn: () => unwrap(staff.sources.presets.get()),
})
export const sourceRunsQuery = (id: string) =>
  queryOptions({
    queryKey: [...queryKeys.admin.sources(), id, 'runs'],
    queryFn: () => unwrap(staff.sources({ id }).runs.get()),
  })
export type NewSource = Parameters<typeof staff.sources.post>[0]
export const addSource = (body: NewSource) => unwrap(staff.sources.post(body))
export const patchSource = (
  id: string,
  body: { label?: string; trusted?: boolean; enabled?: boolean; reportsHidden?: boolean },
) => unwrap(staff.sources({ id }).patch(body))
export const deleteSource = (id: string) => expectOk(staff.sources({ id }).delete())
export const runSource = (id: string) => unwrap(staff.sources({ id }).run.post())
export const resetSourceHealth = (id: string) =>
  unwrap(staff.sources({ id })['reset-health'].post())

export const trustedDomainsQuery = queryOptions({
  queryKey: queryKeys.admin.trustedDomains(),
  queryFn: () => unwrap(staff['trusted-domains'].get()),
})
export const addTrustedDomain = (body: {
  domain: string
  label: string
  origin: 'press' | 'union'
}) => unwrap(staff['trusted-domains'].post(body))
export const removeTrustedDomain = async (domain: string) =>
  void (await staff['trusted-domains']({ domain }).delete())

// --- Movements ------------------------------------------------------------------------------------

/** Every movement, whether or not the public pages are switched on. */
export const adminMovementsQuery = queryOptions({
  queryKey: queryKeys.admin.movements(),
  queryFn: () => unwrap(staff.movements.get()),
})

/** Every event of a movement, hidden ones included (the public page only lists published ones). */
export const movementEventsStaffQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.admin.movementEvents(id),
    queryFn: () => unwrap(staff.movements({ id }).events.get()),
  })
export type NewMovement = Parameters<typeof staff.movements.post>[0]
export const createMovement = (body: NewMovement) => unwrap(staff.movements.post(body))
export const patchMovement = (
  id: string,
  body: Parameters<ReturnType<typeof staff.movements>['patch']>[0],
) => unwrap(staff.movements({ id }).patch(body))
export type NewMovementEvent = Parameters<ReturnType<typeof staff.movements>['events']['post']>[0]
export const addMovementEvent = (id: string, body: NewMovementEvent) =>
  unwrap(staff.movements({ id }).events.post(body))
export const patchMovementEvent = (
  id: string,
  body: Parameters<ReturnType<(typeof staff)['movement-events']>['patch']>[0],
) => unwrap(staff['movement-events']({ id }).patch(body))

/** The mobilisations reported by the press, hidden ones included, newest first. */
export const adminMobilisationsQuery = queryOptions({
  queryKey: queryKeys.admin.mobilisations(),
  queryFn: async () =>
    reviveDates(await unwrap(staff.mobilisations.get({ query: { limit: 300 } }))),
})

// --- Route proposals found in the press ---------------------------------------------------------

export const routeProposalsQuery = (status: 'pending' | 'decided') =>
  queryOptions({
    queryKey: queryKeys.admin.routeProposals(status),
    queryFn: () => unwrap(staff['route-proposals'].get({ query: { status } })),
  })
export type RouteProposal = Awaited<
  ReturnType<NonNullable<ReturnType<typeof routeProposalsQuery>['queryFn']>>
>[number]
export const patchRouteProposal = (
  id: string,
  body: Parameters<ReturnType<(typeof staff)['route-proposals']>['patch']>[0],
) => unwrap(staff['route-proposals']({ id }).patch(body))
export const approveRouteProposal = (
  id: string,
  body: Parameters<ReturnType<(typeof staff)['route-proposals']>['approve']['post']>[0],
) => unwrap(staff['route-proposals']({ id }).approve.post(body))
export const rejectRouteProposal = (id: string) =>
  unwrap(staff['route-proposals']({ id }).reject.post())

// --- Settings, audit, team ----------------------------------------------------------------------

export const settingsAdminQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'settings'],
  queryFn: () => unwrap(staff.settings.get()),
})
export const putSetting = (key: string, value: unknown) =>
  unwrap(staff.settings({ key }).put({ value }))
export const resetSetting = (key: string) => unwrap(staff.settings({ key }).delete())

export const auditQuery = (action?: string) =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'audit', action ?? ''],
    queryFn: () => unwrap(staff.audit.get({ query: { limit: 200, ...(action && { action }) } })),
  })

export const membersQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'members'],
  queryFn: () => unwrap(staff.members.get()),
})
export const inviteMember = (body: { email: string; name: string; role: 'admin' | 'moderator' }) =>
  unwrap(staff.members.post(body))
export const newPasswordLink = (id: string) => unwrap(staff.members({ id })['password-link'].post())

// --- Pipeline, AI, statistics ----------------------------------------------------------------------

export const pipelineOverviewQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'pipeline', 'overview'],
  queryFn: () => unwrap(staff.pipeline.overview.get()),
  refetchInterval: 10_000,
})
export const pipelineEventsQuery = (stage?: string) =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'pipeline', 'events', stage ?? ''],
    queryFn: () =>
      unwrap(staff.pipeline.events.get({ query: { limit: 200, ...(stage && { stage }) } })),
    refetchInterval: 5_000,
  })
export const laneItemsQuery = (state: 'failed' | 'unreadable' | 'deferred') =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'pipeline', 'lane', state],
    queryFn: () => unwrap(staff.pipeline.items.get({ query: { state, limit: 100 } })),
    refetchInterval: 15_000,
  })
export const throughputQuery = (hours: number) =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'pipeline', 'throughput', hours],
    queryFn: () => unwrap(staff.pipeline.throughput.get({ query: { hours } })),
    refetchInterval: 60_000,
  })
export const latencyQuery = (hours: number) =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'pipeline', 'latency', hours],
    queryFn: () => unwrap(staff.pipeline.latency.get({ query: { hours } })),
    refetchInterval: 60_000,
  })
export const retryItems = (body: { itemIds?: string[]; states?: Array<'failed' | 'unreadable'> }) =>
  unwrap(staff.pipeline.retry.post(body))
export const runPipelineNow = () => unwrap(staff.pipeline.run.post())
export type OperationBody = Parameters<typeof staff.pipeline.operations.post>[0]
export const runOperation = (body: OperationBody) => unwrap(staff.pipeline.operations.post(body))

export const aiStatusQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'ai', 'status'],
  queryFn: () => unwrap(staff.ai.status.get()),
  refetchInterval: 30_000,
})
export const aiUsageQuery = (days: number) =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'ai', 'usage', days],
    queryFn: () => unwrap(staff.ai.usage.get({ query: { days } })),
    refetchInterval: 60_000,
  })

export const siteOverviewQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'site-stats'],
  queryFn: () => unwrap(staff.analytics.overview.get({ query: { days: 30 } })),
  refetchInterval: 10_000,
})
export const siteSeriesQuery = (range: '2h' | '24h' | '7d' | '30d' | '90d') =>
  queryOptions({
    queryKey: [...queryKeys.admin.all, 'site-series', range],
    queryFn: () => unwrap(staff.analytics.series.get({ query: { range } })),
    refetchInterval: range === '2h' ? 15_000 : range === '24h' ? 60_000 : 300_000,
  })

export const judgeReportsQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'judge'],
  queryFn: () => unwrap(staff.judge.reports.get({ query: { days: 60 } })),
  staleTime: 60_000,
})
export type JudgedReport = Awaited<
  ReturnType<NonNullable<(typeof judgeReportsQuery)['queryFn']>>
>[number]

export const mediaQuery = queryOptions({
  queryKey: [...queryKeys.admin.all, 'media'],
  queryFn: () => unwrap(staff.media.get({ query: { days: 90 } })),
  staleTime: 60_000,
})
export type MediaRow = Awaited<ReturnType<NonNullable<(typeof mediaQuery)['queryFn']>>>[number]
export const deleteMedia = (id: string) => expectOk(staff.media({ id }).delete())
