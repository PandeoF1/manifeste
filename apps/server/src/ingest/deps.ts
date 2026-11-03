import type { Ai } from '@manifeste/ai'
import type { Database } from '@manifeste/db'
import type { Logger } from '../logger.ts'
import type { AiUsageService } from '../modules/ai/service.ts'
import type { MatchingService } from '../modules/schools/matching.ts'
import type { SettingsService } from '../modules/settings/service.ts'
import type { IngestConfig } from './config.ts'
import type { PipelineEvents } from './events.ts'
import type { ReportStore } from './report-store.ts'
import type { FetchLike } from './types.ts'

export type SweepStage = 'read' | 'extract' | 'resolve' | 'media' | 'routes' | 'signals'

/** Everything a stage needs, injected so tests run the real stages on fake I/O. */
export interface IngestDeps {
  db: Database
  config: IngestConfig
  events: PipelineEvents
  ai: Ai
  aiUsage: Pick<AiUsageService, 'spentToday' | 'flush'>
  matching: MatchingService
  settings: Pick<SettingsService, 'all'>
  reports: ReportStore
  fetchFn: FetchLike
  log: Logger
  now(): Date
  /** Asks for a run of a stage soon; the queue coalesces repeated requests. */
  trigger(stage: SweepStage): Promise<void>
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
