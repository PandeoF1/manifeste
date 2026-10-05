import { Outlet, createRootRouteWithContext, useRouterState } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { TopBar } from '@/components/layout/TopBar'

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
      <TopBar />
      <Outlet />
    </div>
  )
}
