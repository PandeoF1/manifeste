import { useSyncExternalStore } from 'react'

/**
 * Map panels the visitor can collapse (side menu on desktop, figures card on
 * phone, overseas insets). Remembered on the device only; everything is visible by default.
 */
export type PanelKey = 'side' | 'stats' | 'overseas'

const STORAGE_KEY = 'manifeste-hidden-panels'
const ALL: readonly PanelKey[] = ['side', 'stats', 'overseas']

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
    // storage unavailable or unreadable content: everything stays visible
  }

  return {
    isHidden: (key: PanelKey) => hidden.has(key),
    toggle(key: PanelKey) {
      if (hidden.has(key)) hidden.delete(key)
      else hidden.add(key)
      try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify([...hidden]))
      } catch {
        // private browsing: the choice lasts for the session
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

/** [collapsed?, toggle] for a map panel. */
export function usePanelHidden(key: PanelKey): [boolean, () => void] {
  const hidden = useSyncExternalStore(
    prefs.subscribe,
    () => prefs.isHidden(key),
    () => false,
  )
  return [hidden, () => prefs.toggle(key)]
}
