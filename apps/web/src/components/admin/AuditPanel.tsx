import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditQuery } from '@/queries/admin'

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
const show = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v))

/** Who did what, before and after: every staff action on reports, sources, settings and pipeline. */
export function AuditPanel() {
  const [action, setAction] = useState('')
  const audit = useQuery(auditQuery(action || undefined))
  return (
    <div className="space-y-3">
      <label className="field max-w-xs">
        Filtrer par action
        <input
          className="input"
          placeholder="report.approve, source.create…"
          value={action}
          onChange={(e) => setAction(e.target.value.trim())}
        />
      </label>
      {audit.isPending && <div className="h-24 animate-pulse rounded-lg bg-surface" />}
      {audit.data?.length === 0 && <p className="text-muted">Aucune ligne.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
        {audit.data?.map((l) => (
          <li key={l.id} className="p-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <time className="tabular-nums text-muted">{dateFmt.format(l.at)}</time>
              <span className="font-medium">{l.actorEmail ?? 'compte supprimé'}</span>
              <code className="rounded bg-bg px-1.5">{l.action}</code>
              {l.target && <span className="truncate text-xs text-muted">{l.target}</span>}
            </div>
            {(l.before != null || l.after != null) && (
              <p className="mt-1 break-all font-mono text-xs text-muted">
                {l.before != null && <span>avant {show(l.before)} </span>}
                {l.after != null && <span>→ après {show(l.after)}</span>}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
