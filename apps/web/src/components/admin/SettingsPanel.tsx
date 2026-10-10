import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/queryKeys'

const FIELDS = [
  {
    key: 'status_ttl_hours',
    label: 'Durée du direct (heures)',
    help: 'Sans nouveau signal pendant cette durée, un établissement sort de la carte « Direct ». Les autres périodes (24 h, 7 jours, tout) ne changent pas.',
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
    help: 'Deux sources indépendantes qui signalent le même établissement dans cet intervalle : publication sans modération.',
    type: 'number',
    min: 1,
    max: 24,
  },
  {
    key: 'judge_tiers',
    label: 'Niveaux du juge (Jev)',
    help: 'Désactivé : rien ne change. Activé : la carte, les chiffres, l’historique et les données ouvertes ne comptent plus comme bloqués que les signalements confirmés par le juge (et ceux qu’il n’a pas pu lire) ; les mobilisations signalées (rassemblement, incident…) s’affichent à part en gris, les récits et aperçus sont écartés. Rien n’est supprimé : repasser sur Désactivé rétablit tout. Voir l’onglet « Juge (Jev) » avant d’activer.',
    type: 'select',
    options: [
      ['off', 'Désactivé'],
      ['on', 'Activé'],
    ],
  },
  {
    key: 'judge_keep',
    label: 'Seuil « confirmé » du juge',
    help: 'Probabilité à partir de laquelle un signalement est confirmé (0,05 à 1). Recommandé : 0,5.',
    type: 'decimal',
  },
  {
    key: 'judge_low',
    label: 'Seuil « mobilisation » du juge',
    help: 'En dessous de ce seuil, un signalement est écarté (sauf rassemblement ou incident, qui restent en mobilisation). Recommandé : 0,3.',
    type: 'decimal',
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

/** Site settings, editable without a redeploy (validated on the database side). */
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
          {f.type === 'select' ? (
            <select
              name={f.key}
              className="input"
              defaultValue={settings.data[f.key] ?? f.options[0][0]}
            >
              {f.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={f.key}
              type={f.type === 'decimal' ? 'number' : f.type}
              className="input"
              defaultValue={settings.data[f.key] ?? ''}
              required
              {...(f.type === 'number' ? { min: f.min, max: f.max, step: 1 } : {})}
              {...(f.type === 'decimal' ? { min: 0.05, max: 1, step: 0.05 } : {})}
            />
          )}
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
