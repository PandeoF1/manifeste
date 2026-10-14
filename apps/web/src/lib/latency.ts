/** Upper edges of the server's latency histogram, in milliseconds (the last bar is above the last edge). */
export const LATENCY_EDGES_MS = [10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000]

/** "850 ms", "2,4 s", "3 min". */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`
  return `${Math.round(ms / 60_000)} min`
}

/** Label of one histogram bar: "< 10 ms", "10 à 30 ms", "> 5 min". */
export function barLabel(i: number): string {
  const hi = LATENCY_EDGES_MS[i]
  const lo = LATENCY_EDGES_MS[i - 1]
  if (hi === undefined) return `> ${fmtDuration(lo ?? 0)}`
  if (lo === undefined) return `< ${fmtDuration(hi)}`
  return `${fmtDuration(lo)} à ${fmtDuration(hi)}`
}
