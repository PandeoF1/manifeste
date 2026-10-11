import { readText } from '@manifeste/core'
import type { FetchLike } from './types.ts'

export const USER_AGENT = 'ManifesteBot/0.2 (+https://github.com/PandeoF1/manifeste)'

/** Pauses before retrying after a 429 / 503 (Google News refuses bursts). */
export const RETRY_DELAYS_MS = [2_500, 6_000]

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} on ${url}`)
  }
}

/** GET a text resource with the robust decoding, a timeout and a retry on 429 / 503. */
export async function fetchText(
  fetchFn: FetchLike,
  url: string,
  options: {
    timeoutMs?: number
    retryDelaysMs?: readonly number[]
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<string> {
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    })
    if (res.ok) return readText(res)
    const delay = delays[attempt]
    if ((res.status !== 429 && res.status !== 503) || delay === undefined)
      throw new HttpError(res.status, url)
    await res.body?.cancel()
    // A little jitter: parallel readers should not all come back at the same instant.
    await sleep(delay * (0.75 + Math.random() * 0.5))
  }
}

/** Runs `fn` on each item with at most `limit` calls at once (order kept). */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i] as T, i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
