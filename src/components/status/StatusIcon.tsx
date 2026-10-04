import type { ReportStatus } from '@shared/status.ts'

/**
 * Forme distincte par statut (jamais la couleur seule) :
 * bloqué = octogone, filtrant = triangle, levé = cercle.
 * Les mêmes formes sont dessinées sur la carte (voir markerImages.ts).
 */
export function StatusIcon({ status, size = 16 }: { status: ReportStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const
  switch (status) {
    case 'bloque':
      return (
        <svg {...common}>
          <polygon
            points="7,1.5 17,1.5 22.5,7 22.5,17 17,22.5 7,22.5 1.5,17 1.5,7"
            fill="var(--status-bloque)"
            stroke="white"
            strokeWidth="1.5"
          />
          <rect x="6" y="10.5" width="12" height="3" fill="white" />
        </svg>
      )
    case 'filtrant':
      return (
        <svg {...common}>
          <polygon
            points="12,1.5 23,21.5 1,21.5"
            fill="var(--status-filtrant)"
            stroke="white"
            strokeWidth="1.5"
          />
          <rect x="10.75" y="8" width="2.5" height="7" fill="white" />
          <rect x="10.75" y="16.5" width="2.5" height="2.5" fill="white" />
        </svg>
      )
    case 'leve':
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="var(--status-leve)"
            stroke="white"
            strokeWidth="1.5"
          />
          <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="white" strokeWidth="2.5" />
        </svg>
      )
  }
}
