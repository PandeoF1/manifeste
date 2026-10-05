import type { ReportStatus } from '@shared/status.ts'

/** Couleurs de la carte (toujours sombre, indépendante du thème système). */
export const MAP_STATUS_COLORS: Record<ReportStatus, string> = {
  bloque: '#ff453a',
  filtrant: '#ff9f0a',
  leve: '#98a2b3',
}

export const MAP_BASE = {
  background: '#05070b',
  land: '#0a0d13',
  landAlt: '#0d1118',
  water: '#0a1220',
  road: '#151b26',
  boundary: '#3b4456',
  label: '#5f6878',
  labelHalo: '#05070b',
} as const
