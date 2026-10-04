// Factory centralisée des query keys.
export const queryKeys = {
  statuses: {
    all: ['statuses'] as const,
    list: () => [...queryKeys.statuses.all, 'list'] as const,
    counts: () => [...queryKeys.statuses.all, 'counts'] as const,
  },
  school: (uai: string) => ['school', uai] as const,
  schoolReports: (uai: string) => ['school', uai, 'reports'] as const,
  admin: {
    all: ['admin'] as const,
    sources: () => [...queryKeys.admin.all, 'sources'] as const,
    pending: () => [...queryKeys.admin.all, 'pending'] as const,
    unmatched: () => [...queryKeys.admin.all, 'unmatched'] as const,
    trustedDomains: () => [...queryKeys.admin.all, 'trusted-domains'] as const,
  },
  session: ['session'] as const,
}
