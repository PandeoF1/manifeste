import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { MoreVertical } from 'lucide-react'

export interface MenuAction {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  hint?: string
}

/** Menu d'actions (bouton ⋮) : clavier (flèches, Échap), fermeture au clic extérieur. */
export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      ref.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-2xl"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              title={a.hint}
              onClick={() => {
                setOpen(false)
                a.onSelect()
              }}
              className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-bg focus:bg-bg focus:outline-none disabled:opacity-40 ${a.danger ? 'text-bloque' : ''}`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
