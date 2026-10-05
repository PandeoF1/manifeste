import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'

const FIELDS = [
  {
    key: 'status_ttl_hours',
    label: 'Durée du direct (heures)',
    help: 'Sans nouveau signal pendant cette durée, un lycée sort de la carte « Direct ». Les autres périodes (24 h, 7 jours, tout) ne changent pas.',
    type: 'number',
    min: 1,
    max: 168,
  },
  {
    key: 'movement_start',
    label: 'Début du mouvement',
    help: 'Point de départ de la période « Tout » sur la carte et la liste.',
    type: 'date',
  },
  {
    key: 'concordance_window_hours',
    label: 'Fenêtre de concordance (heures)',
    help: 'Deux sources indépendantes qui signalent le même lycée dans cet intervalle : publication sans modération.',
    type: 'number',
    min: 1,
    max: 24,
  },
] as const

const rawSettingsQuery = {
  queryKey: [...queryKeys.admin.all, 'settings'],
  queryFn: async () => {
    const { data, error } = await supabase.from('app_settings').select('key, value')
    if (error) throw error
    return Object.fromEntries(data.map((r) => [r.key, r.value])) as Record<string, string>
  },
}

/** Réglages du site, modifiables sans redéploiement (validés côté base). */
export function SettingsPanel() {
  const queryClient = useQueryClient()
  const settings = useQuery(rawSettingsQuery)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: async (changes: Array<[string, string]>) => {
      for (const [key, value] of changes) {
        const { error } = await supabase.rpc('admin_set_setting', { p_key: key, p_value: value })
        if (error) throw new Error(error.message)
      }
    },
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaved(false)
    const data = new FormData(e.currentTarget)
    const changes = FIELDS.map(
      (f) => [f.key, String(data.get(f.key) ?? '').trim()] as [string, string],
    ).filter(([key, value]) => value !== '' && value !== settings.data?.[key])
    if (changes.length) save.mutate(changes)
    else setSaved(true)
  }

  if (settings.isPending) return <div className="h-48 animate-pulse rounded-lg bg-surface" />
  if (settings.error)
    return <p className="text-bloque">Réglages illisibles : {settings.error.message}</p>

  return (
    <form onSubmit={onSubmit} className="card max-w-xl space-y-5">
      {FIELDS.map((f) => (
        <label key={f.key} className="field">
          {f.label}
          <input
            name={f.key}
            type={f.type}
            className="input"
            defaultValue={settings.data[f.key] ?? ''}
            required
            {...(f.type === 'number' ? { min: f.min, max: f.max, step: 1 } : {})}
          />
          <span className="text-xs font-normal text-muted">{f.help}</span>
        </label>
      ))}
      {save.error && (
        <p role="alert" className="text-sm text-bloque">
          {save.error.message}
        </p>
      )}
      {saved && !save.isPending && (
        <p role="status" className="text-sm text-leve">
          Réglages enregistrés : la carte publique les applique au prochain rafraîchissement.
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={save.isPending}>
        {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  )
}
