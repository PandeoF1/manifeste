/**
 * Talks to a running Manifeste server as a staff member (the same API the admin page uses).
 * It signs in with the account's email and password, keeps the session cookie, and signs in
 * again when the session expires. Use a moderator account: the MCP never needs more.
 */

export type Pending = {
  id: string
  schoolUai: string
  schoolName: string | null
  schoolCity: string | null
  status: string
  origin: string
  observedAt: string
  sourceUrl: string | null
  sourceDomain: string | null
  certainty: string | null
  judge: { probability: number | null; nature: string | null } | null
  tier: string | null
}

export type Decision = 'approve' | 'reject'
export type Outcome = { id: string; ok: boolean; detail: string }

export type ClientOptions = {
  baseUrl: string
  email: string
  password: string
  fetch?: typeof fetch
}

export class StaffClient {
  private readonly base: string
  private readonly doFetch: typeof fetch
  private cookie = ''

  constructor(private readonly opts: ClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '')
    this.doFetch = opts.fetch ?? fetch
  }

  private async signIn() {
    const res = await this.doFetch(`${this.base}/api/auth/sign-in/email`, {
      method: 'POST',
      // better-auth refuses a state-changing call without a trusted origin.
      headers: { 'content-type': 'application/json', origin: this.base },
      body: JSON.stringify({ email: this.opts.email, password: this.opts.password }),
    })
    if (!res.ok) throw new Error(`Sign-in refused (HTTP ${res.status})`)
    const body = (await res.json().catch(() => ({}))) as { twoFactorRedirect?: boolean }
    if (body.twoFactorRedirect) throw new Error('This account needs a 2FA code: use a moderator')
    this.cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    if (!this.cookie) throw new Error('Sign-in gave no session cookie')
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.cookie) await this.signIn()
    const send = () =>
      this.doFetch(`${this.base}${path}`, {
        ...init,
        headers: { ...init.headers, cookie: this.cookie, origin: this.base },
      })
    let res = await send()
    if (res.status === 401) {
      this.cookie = ''
      await this.signIn()
      res = await send()
    }
    return res
  }

  /** The moderation queue (newest first, at most 200 for the server). */
  async pending(): Promise<Pending[]> {
    const res = await this.request('/api/staff/reports/pending')
    if (!res.ok) throw new Error(`Queue unavailable (HTTP ${res.status})`)
    return (await res.json()) as Pending[]
  }

  async decide(id: string, decision: Decision): Promise<Outcome> {
    const form = new FormData()
    form.set('decision', decision)
    const res = await this.request(`/api/staff/reports/${id}/decision`, {
      method: 'POST',
      body: form,
    })
    if (res.ok) return { id, ok: true, detail: decision === 'approve' ? 'approved' : 'rejected' }
    const text = await res.text().catch(() => '')
    return { id, ok: false, detail: `HTTP ${res.status} ${text}`.trim() }
  }
}

export type Filter = {
  origin?: string
  tier?: string
  status?: string
  minProbability?: number
  city?: string
  limit?: number
}

/** The queue narrowed by the caller's filters; a report without a judgement fails `minProbability`. */
export function filterPending(rows: Pending[], f: Filter): Pending[] {
  const city = f.city?.toLowerCase()
  const kept = rows.filter(
    (r) =>
      (!f.origin || r.origin === f.origin) &&
      (!f.tier || r.tier === f.tier) &&
      (!f.status || r.status === f.status) &&
      (f.minProbability === undefined || (r.judge?.probability ?? -1) >= f.minProbability) &&
      (!city || (r.schoolCity ?? '').toLowerCase().includes(city)),
  )
  return kept.slice(0, f.limit ?? 50)
}

/** Largest batch one call may decide: a typo in a filter must not empty the whole queue. */
export const MAX_BATCH = 100

/** Decides the given reports one after the other (the server locks nothing across reports). */
export async function decideAll(
  client: Pick<StaffClient, 'decide'>,
  ids: string[],
  decision: Decision,
): Promise<Outcome[]> {
  const unique = [...new Set(ids)]
  if (unique.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} reports per call`)
  const out: Outcome[] = []
  for (const id of unique) out.push(await client.decide(id, decision))
  return out
}
