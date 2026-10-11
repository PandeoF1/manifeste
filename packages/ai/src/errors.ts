import type { AiErrorKind } from './types.ts'

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    readonly provider: string,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export function kindFromStatus(status: number): AiErrorKind {
  if (status === 429) return 'rate-limit'
  if (status === 404) return 'not-found'
  if (status === 402) return 'billing'
  if (status === 401 || status === 403) return 'auth'
  if (status >= 500) return 'unavailable'
  return 'bad-request'
}

/** Readable message out of a provider's JSON error body (or its start when it is not JSON). */
export async function errorDetail(res: Response): Promise<string> {
  const raw = await res.text()
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string }
    const message =
      typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message)
    if (message) return message.slice(0, 200)
  } catch {
    // not JSON
  }
  return raw.slice(0, 200)
}

export async function httpError(provider: string, model: string, res: Response): Promise<AiError> {
  const detail = await errorDetail(res)
  return new AiError(
    kindFromStatus(res.status),
    provider,
    `${model} HTTP ${res.status}: ${detail}`,
    res.status,
  )
}

/** Wraps a thrown fetch failure (timeout, DNS, reset) so the chain can treat it as temporary. */
export function networkError(provider: string, model: string, e: unknown): AiError {
  if (e instanceof AiError) return e
  const message = e instanceof Error ? e.message : String(e)
  const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
  return new AiError(timeout ? 'unavailable' : 'network', provider, `${model}: ${message}`)
}
