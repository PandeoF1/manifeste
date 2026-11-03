import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { parseUnmatched, type ParsedUnmatched } from '@/lib/unmatchedCsv'
import { queryKeys } from '@/lib/queryKeys'
import { decideUnmatchedMany, unmatchedExportUrl, type UnmatchedBulkResult } from '@/queries/admin'

const REASONS: Record<UnmatchedBulkResult['skipped'][number]['reason'], string> = {
  unknown: 'fait introuvable',
  resolved: 'déjà traité',
  unknown_school: 'UAI inconnu dans le référentiel',
  duplicate: 'en double dans le fichier',
  failed: 'rattachement impossible (source manquante)',
}

/** Export the waiting facts with candidate schools, fill the `uai` column, import it back (preview first). */
export function UnmatchedBulk() {
  const queryClient = useQueryClient()
  const [parsed, setParsed] = useState<ParsedUnmatched | null>(null)
  const preview = useMutation({
    mutationFn: (p: ParsedUnmatched) => decideUnmatchedMany(p.decisions, true),
  })
  const apply = useMutation({
    mutationFn: (p: ParsedUnmatched) => decideUnmatchedMany(p.decisions, false),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.unmatched() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.pending() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
    },
  })

  async function onFile(file: File | undefined) {
    apply.reset()
    preview.reset()
    if (!file) return setParsed(null)
    const result = parseUnmatched(await file.text())
    setParsed(result)
    if (!result.error && result.decisions.length > 0) preview.mutate(result)
  }

  const shown = apply.data ?? preview.data
  const skippedByReason = shown?.skipped.reduce<Record<string, number>>(
    (acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }),
    {},
  )

  return (
    <details className="mt-3 rounded-lg border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Export / import en masse (tableur)
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted">
          1. Exporte les faits en attente : chaque ligne porte le nom cité, la source, l'extrait et
          les 3 meilleurs établissements candidats. 2. Dans la colonne <code>uai</code>, écris l'UAI
          choisi, ou <code>1</code> / <code>2</code> / <code>3</code> pour prendre un candidat, ou{' '}
          <code>ecarter</code> pour écarter le fait (ou envoie le fichier à Claude). 3. Réimporte le
          même fichier : un aperçu s'affiche avant d'appliquer. Une cellule vide laisse le fait en
          attente. Un fait rattaché est publié tout de suite.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            className="btn-secondary inline-flex items-center gap-2"
            href={unmatchedExportUrl}
            download
          >
            <Download size={16} aria-hidden="true" /> Exporter les non rattachés (CSV)
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
            {parsed.blank > 1 ? 's' : ''} laissée{parsed.blank > 1 ? 's' : ''} en attente
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
              {shown.dryRun ? 'Aperçu (rien n’est encore appliqué)' : 'Appliqué'} : {shown.linked} à
              rattacher, {shown.dismissed} à écarter
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
            {shown.dryRun && parsed && shown.linked + shown.dismissed > 0 && (
              <button
                type="button"
                className="btn-primary mt-3"
                disabled={apply.isPending}
                onClick={() => apply.mutate(parsed)}
              >
                {apply.isPending
                  ? 'Application…'
                  : `Appliquer ${shown.linked + shown.dismissed} décisions (les rattachements sont publiés tout de suite)`}
              </button>
            )}
          </div>
        )}
      </div>
    </details>
  )
}
