import { useEffect, useState } from 'react'
import { formatRelative } from '@shared/status.ts'
import type { NationalCounts } from '@/queries/statuses'
import { StatusIcon } from './StatusIcon'

function plural(n: number, one: string, many: string) {
  return n > 1 ? many : one
}

export function NationalCounter({
  counts,
  updatedAt,
}: {
  counts: NationalCounts
  updatedAt: number
}) {
  // Re-rendu chaque minute pour garder "il y a X min" juste.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
      <span className="inline-flex items-center gap-1.5">
        <StatusIcon status="bloque" size={14} />
        <strong>{counts.bloque}</strong> {plural(counts.bloque, 'lycée bloqué', 'lycées bloqués')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusIcon status="filtrant" size={14} />
        <strong>{counts.filtrant}</strong> en barrage filtrant
      </span>
      {updatedAt > 0 && (
        <span className="text-muted">mis à jour {formatRelative(new Date(updatedAt), now)}</span>
      )}
    </p>
  )
}
