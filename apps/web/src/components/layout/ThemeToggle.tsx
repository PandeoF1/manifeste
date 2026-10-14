import { Moon, Sun } from 'lucide-react'
import { setTheme, useTheme } from '@/lib/theme'

/** Dark / light theme switch (remembered on the device). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={next === 'light' ? 'Passer en thème clair' : 'Passer en thème sombre'}
      title={next === 'light' ? 'Thème clair' : 'Thème sombre'}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? (
        <Sun size={20} aria-hidden="true" />
      ) : (
        <Moon size={20} aria-hidden="true" />
      )}
    </button>
  )
}
