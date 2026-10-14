/** Types of the API's answers, taken from the server's own models (type-only imports). */
import type { SchoolStatus as ApiSchoolStatus } from '@server/modules/statuses/model.ts'
import type { PublicReport, SchoolDetail } from '@server/modules/schools/model.ts'
import type { Timeline } from '@server/modules/timeline/model.ts'

export type { PublicReport, SchoolDetail, Timeline }

/** A school with its current (or period) status, as the map and the lists use it. */
export type SchoolStatus = Omit<ApiSchoolStatus, 'lat' | 'lng'> & {
  lat: number
  lng: number
  /** Judge tiers: a mere reported mobilisation (added by the app to lists, never by the server). */
  mobilisation?: boolean
}

/** The schools that have a position: the ones the map and the lists can show. */
export function located(rows: ReadonlyArray<ApiSchoolStatus>): SchoolStatus[] {
  return rows.flatMap((r) =>
    r.lat === null || r.lng === null ? [] : [{ ...r, lat: r.lat, lng: r.lng }],
  )
}
