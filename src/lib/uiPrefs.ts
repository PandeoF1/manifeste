import { useSyncExternalStore } from 'react'

/**
 * Panneaux de la carte que le visiteur peut replier (menu latéral, barre du haut, médaillons
 * d'outre-mer). Mémorisé sur l'appareil uniquement ; tout est visible par défaut.
 */
export type PanelKey = 'side' | 'top' | 'overseas'

const STORAGE_KEY = 'manifeste-hidden-panels'
const ALL: readonly PanelKey[] = ['side', 'top', 'overseas']

interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function createPanelPrefs(storage: () => KeyValueStorage | undefined) {
  const listeners = new Set<() => void>()
  const hidden = new Set<PanelKey>()

  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) for (const k of parsed) if (ALL.includes(k)) hidden.add(k)
  } catch {
    // stockage indisponible ou contenu illisible : tout reste visible
  }

  return {
    isHidden: (key: PanelKey) => hidden.has(key),
    toggle(key: PanelKey) {
      if (hidden.has(key)) hidden.delete(key)
      else hidden.add(key)
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify([...hidden]))
      } catch {
        // navigation privée : le choix vaut pour la session
      }
      listeners.forEach((l) => l())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const prefs = createPanelPrefs(() => (typeof window === 'undefined' ? undefined : localStorage))

/** [replié ?, bascule] pour un panneau de la carte. */
export function usePanelHidden(key: PanelKey): [boolean, () => void] {
  const hidden = useSyncExternalStore(
    prefs.subscribe,
    () => prefs.isHidden(key),
    () => false,
  )
  return [hidden, () => prefs.toggle(key)]
}
