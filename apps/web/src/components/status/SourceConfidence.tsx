import { Newspaper } from 'lucide-react'
import { sourceCount } from '@/lib/confidence'

/** Number of sources behind a report (neutral information, not a reliability label). */
export function SourceConfidence({ count }: { count: number }) {
  const c = sourceCount(count)
  if (c.level === 'inconnu') return null
  return (
    <span title={c.detail} className="inline-flex items-center gap-1 text-sm text-muted">
      <Newspaper size={14} aria-hidden="true" />
      {c.label}
    </span>
  )
}

/** Compact version for list rows. */
export function SourceConfidenceInline({ count }: { count: number }) {
  const c = sourceCount(count)
  if (c.level === 'inconnu') return null
  return (
    <span title={c.detail} className="flex items-center justify-end gap-1 text-muted">
      <Newspaper size={12} aria-hidden="true" />
      {c.label}
    </span>
  )
}
