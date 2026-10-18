import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryKeys'
import { putSetting, resetSetting, settingsAdminQuery } from '@/queries/admin'

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
    help: 'Désactivé : rien ne change. Activé : la carte, les chiffres, l’historique et les données ouvertes ne comptent plus comme bloqués que les signalements confirmés par le juge (et ceux qu’il n’a pas pu lire) ; les mobilisations signalées (rassemblement, incident…) s’affichent à part en gris, les récits et aperçus sont écartés. Rien n’est supprimé : repasser sur Désactivé rétablit tout. Voir l’onglet « Juge » avant d’activer.',
    type: 'boolean',
  },
  {
    key: 'movements_public',
    label: 'Page Mouvements publique',
    help: 'Désactivé (par défaut) : la page Mouvements et son entrée de menu n’existent pas pour les visiteurs, mais l’équipe peut préparer des mouvements dans l’onglet « Mouvements » de l’admin. Activé : la page, les archives et leurs cartes sont publiques.',
    type: 'boolean',
  },
  {
    key: 'marches_on_map',
    label: 'Cortèges sur la carte d’accueil',
    help: 'Désactivé (par défaut) : la carte d’accueil ne montre que les lycées. Activé : les cortèges approuvés des mouvements en cours (Parcours détectés ou saisis à la main) sont tracés sur la carte, selon la période choisie (direct : en cours et à venir ; 24 h, 7 j, tout : jusqu’où remonter), en pointillé quand le parcours est seulement probable.',
    type: 'boolean',
  },
  {
    key: 'media_analysis',
    label: 'Analyse des médias (IA)',
    help: 'Activé : chaque article de presse lu est aussi analysé par l’IA (revendications citées, qui s’exprime, angle, ton) pour l’onglet « Médias ». C’est ~40 % des appels Gemini. Désactivé : plus aucun appel pour ça, les analyses déjà faites restent.',
    type: 'boolean',
  },
  {
    key: 'route_detection',
    label: 'Détection des parcours (IA)',
    help: 'Désactivé (par défaut) : aucun appel. Activé : les articles de presse lus sont cherchés pour des cortèges avec leur parcours. Rien n’est publié : chaque trouvaille arrive dans l’onglet « Parcours » où une personne la vérifie sur la carte avant de l’approuver.',
    type: 'boolean',
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

/** Site settings, editable without a redeploy (validated by the server against each setting's schema). */
export function SettingsPanel() {
  const queryClient = useQueryClient()
  const settings = useQuery(settingsAdminQuery)
  const [saved, setSaved] = useState(false)

  const refresh = () => {
    setSaved(true)
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings })
    void queryClient.invalidateQueries({ queryKey: queryKeys.statuses.all })
  }
  const save = useMutation({
    mutationFn: async (changes: Array<[string, unknown]>) => {
      for (const [key, value] of changes) await putSetting(key, value)
    },
    onSuccess: refresh,
  })
  const reset = useMutation({ mutationFn: resetSetting, onSuccess: refresh })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaved(false)
    const data = new FormData(e.currentTarget)
    const changes: Array<[string, unknown]> = []
    for (const f of FIELDS) {
      const current = settings.data?.find((s) => s.key === f.key)?.value
      const raw = String(data.get(f.key) ?? '').trim()
      if (raw === '') continue
      const value = f.type === 'boolean' ? raw === 'on' : f.type === 'date' ? raw : Number(raw)
      if (value !== current) changes.push([f.key, value])
    }
    if (changes.length) save.mutate(changes)
    else setSaved(true)
  }

  if (settings.isPending) return <div className="h-48 animate-pulse rounded-lg bg-surface" />
  if (settings.error)
    return <p className="text-bloque">Réglages illisibles : {settings.error.message}</p>

  const byKey = new Map(settings.data.map((s) => [s.key, s]))
  return (
    <form onSubmit={onSubmit} className="card max-w-xl space-y-5">
      {FIELDS.map((f) => {
        const s = byKey.get(f.key)
        return (
          <label key={f.key} className="field">
            {f.label}
            {f.type === 'boolean' ? (
              <select
                name={f.key}
                className="input"
                defaultValue={s?.value === true ? 'on' : 'off'}
              >
                <option value="off">Désactivé</option>
                <option value="on">Activé</option>
              </select>
            ) : (
              <input
                name={f.key}
                type={f.type === 'decimal' ? 'number' : f.type}
                className="input"
                defaultValue={String(s?.value ?? '')}
                required
                {...(f.type === 'number' ? { min: f.min, max: f.max, step: 1 } : {})}
                {...(f.type === 'decimal' ? { min: 0.05, max: 1, step: 0.05 } : {})}
              />
            )}
            <span className="text-xs font-normal text-muted">
              {f.help}
              {s && !s.isDefault && (
                <>
                  {' '}
                  <button type="button" className="underline" onClick={() => reset.mutate(f.key)}>
                    Revenir à la valeur par défaut ({String(s.default)})
                  </button>
                </>
              )}
            </span>
          </label>
        )
      })}
      {(save.error ?? reset.error) && (
        <p role="alert" className="text-sm text-bloque">
          {(save.error ?? reset.error)?.message}
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
