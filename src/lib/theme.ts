import { useSyncExternalStore } from 'react'

/**
 * Thème de la partie publique : sombre par défaut (identité visuelle), clair au choix.
 * Préférence mémorisée sur l'appareil uniquement (rien n'est envoyé). Appliquée avant le
 * premier affichage par public/theme-init.js (même clé), sans flash.
 */
export type Theme = 'dark' | 'light'
export const THEME_KEY = 'manifeste-theme'
const THEME_COLOR: Record<Theme, string> = { dark: '#07090d', light: '#f6f6f4' }

const listeners = new Set<() => void>()

function read(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

let current: Theme = typeof window === 'undefined' ? 'dark' : read()

export function setTheme(theme: Theme) {
  current = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // navigation privée : le choix vaut pour la session
  }
  listeners.forEach((l) => l())
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => 'dark',
  )
}

/** Pose la classe de thème sur <html> (null = l'admin, qui suit le thème système). */
export function applyThemeClass(theme: Theme | null) {
  const root = document.documentElement
  root.classList.toggle('theme-dark', theme === 'dark')
  root.classList.toggle('theme-light', theme === 'light')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && theme) meta.setAttribute('content', THEME_COLOR[theme])
}
