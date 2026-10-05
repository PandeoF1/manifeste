import type { ReactNode } from 'react'
import { History } from 'lucide-react'
import { formatRelative } from '@shared/status.ts'
import type { NationalStats } from '@/queries/statuses'
import { useCountUp } from '@/lib/useCountUp'
import { useNow } from '@/lib/useNow'
import { StatusIcon } from './StatusIcon'

interface Props {
  stats: NationalStats
  updatedAt: number
  isError: boolean
  /** Variante compacte (overlay mobile). */
  compact?: boolean
  /** Période passée : « ces 7 derniers jours »… (absent en direct). */
  history?: string
  /** Sélecteur de période, affiché sous l'en-tête. */
  picker?: ReactNode
}

export function LiveIndicator({ updatedAt, isError }: { updatedAt: number; isError: boolean }) {
  const now = useNow()
  return (
    <p className="flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${isError ? 'bg-filtrant' : 'live-dot bg-bloque'}`}
      />
      <span>{isError ? 'Connexion perdue' : 'En direct'}</span>
      {updatedAt > 0 && (
        <span className="font-normal tracking-normal normal-case text-muted">
          · mis à jour {formatRelative(new Date(updatedAt), now)}
        </span>
      )}
    </p>
  )
}

function HistoryIndicator({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
      <History size={14} aria-hidden="true" className="text-muted" />
      <span>Bilan</span>
      <span className="font-normal tracking-normal normal-case text-muted">· {label}</span>
    </p>
  )
}

export function HeroStats({ stats, updatedAt, isError, compact = false, history, picker }: Props) {
  const bloque = useCountUp(stats.bloque)
  const filtrant = useCountUp(stats.filtrant)
  const plural = (n: number) => (n > 1 ? 's' : '')

  return (
    <section aria-labelledby="hero-title" className={compact ? 'space-y-0.5' : 'space-y-3'}>
      {history ? (
        <HistoryIndicator label={history} />
      ) : (
        <LiveIndicator updatedAt={updatedAt} isError={isError} />
      )}
      {picker}
      <h2 id="hero-title" className={compact ? 'sr-only' : 'text-sm font-semibold text-muted'}>
        Partout en France, les lycéens se font entendre.
      </h2>
      {/* Lecteurs d'écran : une phrase complète, mise à jour sans annoncer l'animation. */}
      <p className="sr-only" aria-live="polite">
        {history ? `${history[0]?.toUpperCase()}${history.slice(1)}, ` : ''}
        {stats.bloque} lycée{plural(stats.bloque)} {history ? 'ont été ' : ''}bloqué
        {plural(stats.bloque)}, {stats.filtrant} en barrage filtrant, dans {stats.departments}{' '}
        département{plural(stats.departments)}.
      </p>
      <div aria-hidden="true">
        <p className="flex items-baseline gap-3">
          <span
            className={`hero-number font-black leading-none text-bloque ${compact ? 'text-4xl' : 'text-7xl'}`}
          >
            {bloque}
          </span>
          <span className={`font-bold leading-tight ${compact ? 'text-base' : 'text-xl'}`}>
            lycée{plural(stats.bloque)}
            {compact ? ' ' : <br />}
            {history ? (stats.bloque > 1 ? 'ont été ' : 'a été ') : ''}
            bloqué{plural(stats.bloque)}
          </span>
        </p>
        <p className={`flex items-center gap-2 ${compact ? 'mt-0.5 text-sm' : 'mt-3 text-lg'}`}>
          <StatusIcon status="filtrant" size={compact ? 14 : 18} />
          <strong className="tabular-nums text-filtrant">{filtrant}</strong> en barrage filtrant
        </p>
        <p className={`text-muted ${compact ? 'text-xs' : 'mt-1 text-sm'}`}>
          dans <strong className="text-fg">{stats.departments}</strong> département
          {plural(stats.departments)}
          {!history && stats.lastHour > 0 && (
            <>
              {' '}
              · <strong className="text-fg">+{stats.lastHour}</strong> en 1 h
            </>
          )}
        </p>
      </div>
    </section>
  )
}

export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Légende">
      <li className="flex items-center gap-1.5">
        <StatusIcon status="bloque" size={14} /> Bloqué
      </li>
      <li className="flex items-center gap-1.5">
        <StatusIcon status="filtrant" size={14} /> Barrage filtrant
      </li>
      <li className="flex items-center gap-1.5">
        <StatusIcon status="leve" size={14} /> Levé
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border-2 border-bloque" /> Signal de
        moins de 30 min
      </li>
    </ul>
  )
}
