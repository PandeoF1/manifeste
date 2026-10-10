const nf = new Intl.NumberFormat('fr-FR')
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Paris',
})

export const fmtInt = (n: number) => nf.format(n)

/** "2026-10-06" (calendar day) -> "6 oct." */
export const fmtDay = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`))
export const fmtDayLong = (iso: string) => dayLong.format(new Date(`${iso}T00:00:00Z`))

export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso)).replace(':', ' h ')

/** A "round" step for the vertical axis. */
export function niceStep(max: number): number {
  const raw = max / 3
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

export function pct(part: number, total: number): string {
  if (total <= 0) return '0 %'
  const v = (part / total) * 100
  return `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1).replace('.', ',')} %`
}
