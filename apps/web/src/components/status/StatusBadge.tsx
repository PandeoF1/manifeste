import { type ReportStatus } from '@manifeste/core'
import { STATUS_LABELS } from '@/lib/labels'
import { StatusIcon } from './StatusIcon'

const TEXT_CLASS: Record<ReportStatus, string> = {
  blocked: 'text-bloque',
  filtering: 'text-filtrant',
  lifted: 'text-leve',
}

export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${TEXT_CLASS[status]}`}>
      <StatusIcon status={status} />
      {STATUS_LABELS[status]}
    </span>
  )
}
