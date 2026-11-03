import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { parseDecisions, type ParsedDecisions } from '@/lib/decisionsCsv'
import { queryKeys } from '@/lib/queryKeys'
import { decideMany, queueExportUrl, type BulkResult } from '@/queries/admin'

const REASONS: Record<BulkResult['skipped'][number]['reason'], string> = {
  unknown: 'introuvable',
  already_decided: 'déjà décidé',
  needs_photo_check: 'photo à flouter : à valider à la main',
  duplicate: 'en double dans le fichier',
}

/** Export the queue as CSV, decide it in a spreadsheet, import it back (preview first). */
export function BulkDecisions() {
  const queryClient = useQueryClient()
  const [parsed, setParsed] = useState<ParsedDecisions | null>(null)
  const preview = useMutation({ mutationFn: (p: ParsedDecisions) => decideMany(p.decisions, true) })
  const apply = useMutation({
    mutationFn: (p: ParsedDecisions) => decideMany(p.decisions, false),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pending() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
    },
  })

  async function onFile(file: File | undefined) {
    apply.reset()
    preview.reset()
    if (!file) return setParsed(null)
    const result = parseDecisions(await file.text())
    setParsed(result)
    if (!result.error && result.decisions.length > 0) preview.mutate(result)
  }

  const shown = apply.data ?? preview.data
  const skippedByReason = shown?.skipped.reduce<Record<string, number>>(
    (acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }),
    {},
  )

  return (
    <details className="mb-4 rounded-lg border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Export / import en masse (tableur)
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted">
          1. Exporte la file. 2. Remplis la colonne <code>decision</code> (<code>approve</code> ou{' '}
          <code>reject</code>, ou « valider » / « rejeter »), ou envoie le fichier à Claude pour
          qu'il le remplisse. 3. Réimporte le même fichier : un aperçu s'affiche avant d'appliquer.
          Les lignes sans décision sont laissées en attente.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            className="btn-secondary inline-flex items-center gap-2"
            href={queueExportUrl}
            download
          >
            <Download size={16} aria-hidden="true" /> Exporter la file (CSV)
          </a>
          <label className="btn-secondary inline-flex cursor-pointer items-center gap-2">
            <Upload size={16} aria-hidden="true" /> Importer un fichier
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </div>

        {parsed?.error && (
          <p role="alert" className="text-bloque">
            {parsed.error}
          </p>
        )}
        {parsed && !parsed.error && (
          <p>
            {parsed.decisions.length} décision{parsed.decisions.length > 1 ? 's' : ''} lue
            {parsed.decisions.length > 1 ? 's' : ''}, {parsed.blank} ligne
            {parsed.blank > 1 ? 's' : ''} sans décision
            {parsed.unreadable.length > 0 && (
              <span className="text-bloque">
                {' '}
                · illisibles (lignes) : {parsed.unreadable.slice(0, 12).join(', ')}
                {parsed.unreadable.length > 12 ? '…' : ''}
              </span>
            )}
            .
          </p>
        )}
        {(preview.error || apply.error) && (
          <p role="alert" className="text-bloque">
            Échec : {(apply.error ?? preview.error)?.message}
          </p>
        )}
        {shown && (
          <div className="rounded-md bg-bg p-3">
            <p className="font-semibold">
              {shown.dryRun ? 'Aperçu (rien n’est encore appliqué)' : 'Appliqué'} : {shown.approved}{' '}
              à valider, {shown.rejected} à rejeter
            </p>
            {skippedByReason && Object.keys(skippedByReason).length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-muted">
                {Object.entries(skippedByReason).map(([reason, n]) => (
                  <li key={reason}>
                    {n} ignoré{n > 1 ? 's' : ''} : {REASONS[reason as keyof typeof REASONS]}
                  </li>
                ))}
              </ul>
            )}
            {shown.dryRun && parsed && shown.approved + shown.rejected > 0 && (
              <button
                type="button"
                className="btn-primary mt-3"
                disabled={apply.isPending}
                onClick={() => apply.mutate(parsed)}
              >
                {apply.isPending
                  ? 'Application…'
                  : `Appliquer ${shown.approved + shown.rejected} décisions (visible tout de suite sur la carte)`}
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  )
}
