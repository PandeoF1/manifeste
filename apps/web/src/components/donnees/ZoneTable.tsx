import { useState } from 'react'
import type { Zone } from '@/queries/donnees'
import { fmtDay, fmtInt } from '@/lib/donneesFormat'

/** Table per department or academy; the first rows, then "show all". */
export function ZoneTable({
  zones,
  label,
  nameOf = (z) => z,
  initial = 10,
}: {
  zones: Zone[]
  label: string
  nameOf?: (zone: string) => string
  initial?: number
}) {
  const [all, setAll] = useState(false)
  const hasMob = zones.some((z) => (z.mobilises ?? 0) > 0)
  const rows = all ? zones : zones.slice(0, initial)
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm tabular-nums">
          <caption className="sr-only">{label}</caption>
          <thead className="border-b border-border text-muted">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">
                {label}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Établissements
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                dont facs
              </th>
              {hasMob && (
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Mobilisation signalée
                </th>
              )}
              <th scope="col" className="py-2 pr-3 font-medium">
                Premier jour
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                En ce moment
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((z) => (
              <tr key={z.zone} className="border-b border-border/60">
                <th scope="row" className="py-2 pr-3 font-normal">
                  {nameOf(z.zone)}
                </th>
                <td className="py-2 pr-3 text-right font-semibold">{fmtInt(z.etablissements)}</td>
                <td className="py-2 pr-3 text-right">{fmtInt(z.facs)}</td>
                {hasMob && <td className="py-2 pr-3 text-right">{fmtInt(z.mobilises ?? 0)}</td>}
                <td className="py-2 pr-3">{z.premier_jour ? fmtDay(z.premier_jour) : '–'}</td>
                <td className="py-2 text-right">
                  {fmtInt(z.bloques_maintenant + z.filtrants_maintenant)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {zones.length > initial && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="min-h-11 text-sm underline underline-offset-4"
        >
          {all ? 'Réduire' : `Tout afficher (${zones.length})`}
        </button>
      )}
    </div>
  )
}
