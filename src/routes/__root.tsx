import { useEffect } from 'react'
import { Outlet, createRootRouteWithContext, useRouterState } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { TopBar } from '@/components/layout/TopBar'
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

function RootLayout() {
  // Partie publique toujours en thème sombre (identité visuelle) ; l'admin suit le thème système.
  // Le thème est posé sur <html> : le fond de la page entière suit, jamais de bande claire.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const dark = !pathname.startsWith('/admin')
  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', dark)
  }, [dark])
  useKeyboardScrollReset()
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
      <div id="contenu" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
      <ReportFab />
      <UpdatePrompt />
      <InstallPrompt />
    </div>
  )
}

/**
 * Téléphone : à la fermeture du clavier, certains navigateurs laissent la fenêtre défilée
 * (elle l'a été pour montrer le champ). On la remet en place.
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
