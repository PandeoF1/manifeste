import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
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
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <Outlet />
    </div>
  )
}
