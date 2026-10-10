import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { normalizeDomainInput } from '@shared/domain.ts'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'
import { trustedDomainsQuery } from '@/queries/admin'

export function TrustedDomainsPanel() {
  const queryClient = useQueryClient()
  const domains = useQuery(trustedDomainsQuery)
  const [error, setError] = useState<string | null>(null)
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.trustedDomains() })

  const add = useMutation({
    mutationFn: async (row: { domain: string; label: string; kind: 'presse' | 'syndicat' }) => {
      const { error } = await supabase.from('trusted_domains').insert(row)
      if (error) throw new Error(error.code === '23505' ? 'Domaine déjà présent.' : error.message)
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (domain: string) => {
      const { error } = await supabase.from('trusted_domains').delete().eq('domain', domain)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const domain = normalizeDomainInput(String(data.get('domain') ?? ''))
    const label = String(data.get('label') ?? '').trim()
    if (!domain || !label) {
      setError('Domaine et libellé requis.')
      return
    }
    setError(null)
    add.mutate(
      { domain, label, kind: data.get('kind') === 'syndicat' ? 'syndicat' : 'presse' },
      { onSuccess: () => form.reset() },
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="card grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
        <input
          name="domain"
          required
          placeholder="exemple.fr"
          className="input"
          aria-label="Domaine"
        />
        <input name="label" required placeholder="Libellé" className="input" aria-label="Libellé" />
        <select name="kind" className="input" aria-label="Nature">
          <option value="presse">presse</option>
          <option value="syndicat">syndicat</option>
        </select>
        <button type="submit" className="btn-primary">
          Ajouter
        </button>
        {(error || add.error) && (
          <p role="alert" className="text-sm text-bloque md:col-span-4">
            {error ?? add.error?.message}
          </p>
        )}
      </form>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {domains.data?.map((d) => (
          <li key={d.domain} className="flex items-center gap-3 px-3 py-1">
            <span className="flex-1">
              <span className="font-medium">{d.domain}</span>{' '}
              <span className="text-muted">
                · {d.label} · {d.kind}
              </span>
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Retirer ${d.domain}`}
              onClick={() => remove.mutate(d.domain)}
            >
              <Trash2 size={18} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
