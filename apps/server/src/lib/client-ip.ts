/**
 * The visitor's IP, only ever used in memory to derive a salted hash or to rate-limit.
 * The server runs behind Cloudflare and the Coolify proxy, which set these headers; running it
 * directly on the internet would let a client choose its own address, so keep it behind the proxy.
 */
export function clientIp(headers: Headers, socketIp: string | null | undefined): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? forwarded ?? socketIp ?? ''
}
