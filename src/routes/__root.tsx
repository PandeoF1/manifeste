import { Outlet, createRootRouteWithContext, useRouterState } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { TopBar } from '@/components/layout/TopBar'
import { BottomTabs } from '@/components/layout/BottomTabs'
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
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div className={`flex h-full flex-col ${pathname.startsWith('/admin') ? '' : 'theme-dark'}`}>
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
      <BottomTabs />
      <UpdatePrompt />
      <InstallPrompt />
    </div>
  )
}
