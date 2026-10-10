import { STATUS_LABELS, type ReportStatus } from '@shared/status.ts'
import { StatusIcon } from './StatusIcon'

const TEXT_CLASS: Record<ReportStatus, string> = {
  bloque: 'text-bloque',
  filtrant: 'text-filtrant',
  leve: 'text-leve',
}

export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${TEXT_CLASS[status]}`}>
      <StatusIcon status={status} />
      {STATUS_LABELS[status]}
    </span>
  )
}
