import type { pipelineOverviewQuery } from '@/queries/admin'

export type Overview = Awaited<ReturnType<NonNullable<(typeof pipelineOverviewQuery)['queryFn']>>>
