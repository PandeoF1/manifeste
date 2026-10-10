import { useSyncExternalStore } from 'react'

/**
 * Public-side theme: dark by default (visual identity), light on request.
 * Preference remembered on the device only (nothing is sent). Applied before the
 * first paint by public/theme-init.js (same key), without a flash.
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
    // private browsing: the choice lasts for the session
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

/** Sets the theme class on <html> (null = the admin, which follows the system theme). */
export function applyThemeClass(theme: Theme | null) {
  const root = document.documentElement
  root.classList.toggle('theme-dark', theme === 'dark')
  root.classList.toggle('theme-light', theme === 'light')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && theme) meta.setAttribute('content', THEME_COLOR[theme])
}
