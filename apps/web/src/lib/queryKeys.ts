// Central factory of query keys.
export const queryKeys = {
  statuses: {
    all: ['statuses'] as const,
    list: () => [...queryKeys.statuses.all, 'list'] as const,
    counts: () => [...queryKeys.statuses.all, 'counts'] as const,
    period: (period: string, start: string) =>
      [...queryKeys.statuses.all, 'period', period, start] as const,
  },
  settings: ['settings'] as const,
  movements: {
    all: ['movements'] as const,
    list: () => [...queryKeys.movements.all, 'list'] as const,
    one: (slug: string) => [...queryKeys.movements.all, slug] as const,
  },
  // Outside `statuses`: history is heavy, it does not reload on every report.
  timeline: (start: string) => ['timeline', start] as const,
  donnees: (vue: string) => ['donnees', vue] as const,
  school: (uai: string) => ['school', uai] as const,
  schoolReports: (uai: string) => ['school', uai, 'reports'] as const,
  schoolDetail: (uai: string) => ['school', uai, 'detail'] as const,
  schoolHistory: (uai: string) => ['school', uai, 'history'] as const,
  admin: {
    all: ['admin'] as const,
    sources: () => [...queryKeys.admin.all, 'sources'] as const,
    pending: () => [...queryKeys.admin.all, 'pending'] as const,
    moderatorPending: () => [...queryKeys.admin.all, 'pending-moderator'] as const,
    reports: () => [...queryKeys.admin.all, 'reports'] as const,
    unmatched: () => [...queryKeys.admin.all, 'unmatched'] as const,
    trustedDomains: () => [...queryKeys.admin.all, 'trusted-domains'] as const,
    movementEvents: (id: string) => [...queryKeys.admin.all, 'movement-events', id] as const,
  },
  session: ['session'] as const,
}
