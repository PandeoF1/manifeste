import { Link } from '@tanstack/react-router'

export function TopBar() {
  return (
    <header
      className="relative z-20 flex h-12 items-center justify-between border-b border-border bg-surface px-4"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <Link to="/" search={{}} className="text-base font-bold tracking-tight">
        Manifest
      </Link>
      <nav aria-label="Navigation principale" className="flex items-center gap-1 text-sm">
        <Link
          to="/"
          search={{}}
          className="rounded-md px-3 py-2 hover:bg-bg"
          activeProps={{
            className: 'font-semibold underline underline-offset-4',
            'aria-current': 'page',
          }}
          activeOptions={{ includeSearch: false }}
        >
          Carte
        </Link>
      </nav>
    </header>
  )
}
