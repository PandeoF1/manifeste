/** On-site reports: limits shared by the form and the server. */

/** Max distance between the sent position and the chosen school. */
export const MAX_DISTANCE_M = 2000
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
/** Reports per visitor per day (visitor = salted hash of the IP, salt destroyed every night). */
export const DAILY_LIMIT = 5
/** Unreviewed originals are deleted after this many hours. */
export const PHOTO_RETENTION_HOURS = 48

/** Rounded to 3 decimals (~100 m): a person's exact position is never kept. */
export const roundCoord = (value: number): number => Math.round(value * 1000) / 1000

export const SUBMIT_ERRORS = [
  'invalid_input',
  'captcha_failed',
  'rate_limited',
  'unknown_school',
  'too_far',
  'photo_invalid',
  'photo_metadata',
  'server_error',
] as const
export type SubmitError = (typeof SUBMIT_ERRORS)[number]
