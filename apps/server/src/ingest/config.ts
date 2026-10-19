import type { Certainty } from '@manifeste/core'

/** Tunables of the pipeline. The defaults are what production ran on before the rework. */
export interface IngestConfig {
  /** Items published longer ago than this are ignored. */
  lookbackHours: number
  /** Relevant items taken from one source per pass, most recent first (the rest wait for the next pass). */
  maxItemsPerSource: number
  /** A map can hold hundreds of points: no useful bound. */
  maxItemsMap: number
  /** Sources read at once. */
  discoverConcurrency: number
  /** Items read (fetched and parsed) per run of the read stage. */
  readBatch: number
  pageConcurrency: number
  /** Items per AI call. */
  extractBatchSize: number
  /** AI calls per run of the extract stage; the rest waits for the next run. */
  maxExtractCalls: number
  /**
   * An extract sweep waits for a full batch (every call repeats the instructions); items that
   * have waited this long go anyway. 0 sends whatever is ready.
   */
  extractMaxWaitMinutes: number
  /** Extracted facts handled per run of the resolve stage. */
  resolveBatch: number
  /** Facts below this certainty are dropped. */
  minCertainty: Certainty
  /** Judge calls per run: the judge must never hold the pipeline back. */
  maxJudgeCalls: number
  /** Analyse how press articles treat the mobilisation (the admin Medias tab). It spends AI calls. */
  mediaAnalysis: boolean
  /** AI calls per run of the media stage. */
  maxMediaCalls: number
  /** Articles per media call. */
  mediaBatchSize: number
  /** The media stage is not urgent: it waits for a full batch up to this long. 0 sends whatever is ready. */
  mediaMaxWaitMinutes: number
  /** Look for marches in articles (also needs the admin switch `route_detection`). */
  routeDetection: boolean
  /** AI calls per run of the routes stage. */
  maxRoutesCalls: number
  /** Articles per routes call. */
  routesBatchSize: number
  /** Look for signaled mobilisations in articles (also needs the admin switch `signaled_mobilisations`). */
  signalsEnabled: boolean
  /** AI calls per run of the signals stage. */
  maxSignalsCalls: number
  /** Articles per signals call. */
  signalsBatchSize: number
  /** Ask a reading gateway for the text of pages closed to robots. */
  readerGateway: boolean
  /** Attempts before an item goes to the failed lane. */
  maxAttempts: number
  /** Item text and unmatched excerpts are deleted after this. */
  contentRetentionDays: number
  eventRetentionDays: number
  /** How often the sources are due. */
  tickCron: string
}

export const DEFAULT_INGEST_CONFIG: IngestConfig = {
  lookbackHours: 48,
  maxItemsPerSource: 30,
  maxItemsMap: 300,
  discoverConcurrency: 4,
  readBatch: 60,
  pageConcurrency: 5,
  // Small calls: one article that confuses or manipulates the model then reaches few others,
  // and an answer is never cut by its length. 15 x 12 handles as many items per run as 50 x 4 did.
  extractBatchSize: 15,
  maxExtractCalls: 12,
  extractMaxWaitMinutes: 0,
  resolveBatch: 200,
  minCertainty: 'medium',
  maxJudgeCalls: 60,
  mediaAnalysis: true,
  maxMediaCalls: 2,
  mediaBatchSize: 20,
  mediaMaxWaitMinutes: 120,
  routeDetection: true,
  signalsEnabled: true,
  maxSignalsCalls: 4,
  signalsBatchSize: 8,
  maxRoutesCalls: 3,
  routesBatchSize: 6,
  readerGateway: true,
  maxAttempts: 3,
  contentRetentionDays: 7,
  eventRetentionDays: 30,
  tickCron: '*/10 * * * *',
}
