import type { ReportStatus } from '@manifeste/core'

/**
 * A distinct shape per status (never colour alone):
 * blocked = octagon, filtering = triangle, lifted = circle.
 * The same shapes are drawn on the map (see markerImages.ts).
 */
export function StatusIcon({ status, size = 16 }: { status: ReportStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true } as const
  switch (status) {
    case 'blocked':
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
    case 'filtering':
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
    case 'lifted':
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

/** Reported mobilisation: translucent ochre ring, as on the map. */
export function MobilisationIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="var(--mobilisation)"
        fillOpacity="0.28"
        stroke="var(--mobilisation)"
        strokeWidth="2.5"
      />
    </svg>
  )
}
