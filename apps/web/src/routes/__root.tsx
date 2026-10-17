import { useEffect } from 'react'
import {
  Outlet,
  createRootRouteWithContext,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { TopBar } from '@/components/layout/TopBar'
import { applyThemeClass, useTheme, type Theme } from '@/lib/theme'
import { ReportFab } from '@/components/layout/ReportFab'
import { InstallPrompt, OfflineBanner, UpdatePrompt } from '@/components/layout/AppNotices'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => (
    <main className="p-6">
      <h1 className="text-xl font-bold">Page introuvable</h1>
    </main>
  ),
})

/** Text pages narrower than the screen: their side margins act as "back to the map". */
const READING_PAGES = ['/liste', '/donnees', '/a-propos', '/mouvements']

function RootLayout() {
  // Public side: chosen theme (dark by default); the admin follows the system theme.
  // The theme is set on <html>: the whole page background follows, never a light band.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const theme = useTheme()
  // Embedded pages (iframe): dark by default, light with ?theme=clair; no menus.
  const embed = pathname.startsWith('/embed')
  const embedTheme: Theme =
    embed && new URLSearchParams(window.location.search).get('theme') === 'clair' ? 'light' : 'dark'
  const applied = embed ? embedTheme : pathname.startsWith('/admin') ? null : theme
  useEffect(() => applyThemeClass(applied), [applied])
  useKeyboardScrollReset()
  if (embed) {
    return (
      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-bg focus:p-3"
      >
        Aller au contenu
      </a>
      <TopBar />
      <OfflineBanner />
      {/* Reading pages (desktop): a click on the empty margins goes back to the map. */}
      <div
        id="contenu"
        className="flex min-h-0 flex-1 flex-col"
        onClick={(e) => {
          if (e.target === e.currentTarget && READING_PAGES.includes(pathname))
            void navigate({ to: '/', search: {} })
        }}
      >
        <Outlet />
      </div>
      <ReportFab />
      <UpdatePrompt />
      <InstallPrompt />
    </div>
  )
}

/**
 * Phone: when the keyboard closes, some browsers leave the window scrolled
 * (it was scrolled to show the field). Put it back.
 */
function useKeyboardScrollReset() {
  useEffect(() => {
    const reset = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }
    const onFocusOut = () => window.setTimeout(reset, 100)
    window.visualViewport?.addEventListener('resize', reset)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      window.visualViewport?.removeEventListener('resize', reset)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])
}
