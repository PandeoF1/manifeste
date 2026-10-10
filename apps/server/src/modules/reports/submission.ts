/**
 * Validation of an on-site report. Done by hand (not by the route schema) so that every refusal
 * is a coded error the form can translate, whatever is wrong with the request.
 */
import {
  extractDomain,
  isUai,
  MAX_DISTANCE_M,
  REPORT_STATUSES,
  type ReportStatus,
} from '@manifeste/core'

export { MAX_DISTANCE_M }

export interface RawSubmission {
  schoolUai?: string
  newSchoolName?: string
  newSchoolCity?: string
  status?: string
  lat?: number | string
  lng?: number | string
  sourceUrl?: string
  turnstileToken?: string
}

export interface Submission {
  /** A school of the directory, or a proposed one (name + city) that staff will check. */
  school: { uai: string } | { name: string; city: string }
  status: ReportStatus
  lat: number
  lng: number
  sourceUrl: string | null
  sourceDomain: string | null
  turnstileToken: string | null
}

/** Forms send empty fields as empty strings. */
const blank = (v: string | undefined): string | undefined => {
  const t = v?.trim()
  return t ? t : undefined
}

const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max

export function parseSubmission(raw: RawSubmission): Submission | null {
  const uai = blank(raw.schoolUai)
  const name = blank(raw.newSchoolName)
  const city = blank(raw.newSchoolCity)
  const status = raw.status as ReportStatus
  const lat = Number(raw.lat)
  const lng = Number(raw.lng)
  const url = blank(raw.sourceUrl)

  if (!REPORT_STATUSES.includes(status)) return null
  if (!inRange(lat, -90, 90) || !inRange(lng, -180, 180)) return null
  if (raw.lat === '' || raw.lng === '' || raw.lat == null || raw.lng == null) return null

  let school: Submission['school']
  if (uai) {
    if (!isUai(uai) || name) return null
    school = { uai }
  } else {
    if (!name || !city || name.length < 3 || name.length > 120 || city.length > 80) return null
    school = { name, city }
  }

  let sourceDomain: string | null = null
  if (url) {
    if (url.length > 2000) return null
    sourceDomain = extractDomain(url)
    if (!sourceDomain) return null
  }
  return {
    school,
    status,
    lat,
    lng,
    sourceUrl: url ?? null,
    sourceDomain,
    turnstileToken: blank(raw.turnstileToken)?.slice(0, 4096) ?? null,
  }
}
