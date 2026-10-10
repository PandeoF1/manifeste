import type { ReportStatus } from '@shared/status.ts'

/** Couleurs des signaux : identiques dans les deux thèmes (formes cerclées de noir). */
export const MAP_STATUS_COLORS: Record<ReportStatus, string> = {
  bloque: '#ff453a',
  filtrant: '#ff9f0a',
  leve: '#98a2b3',
}

export interface MapBase {
  background: string
  land: string
  landAlt: string
  water: string
  road: string
  boundary: string
  label: string
  labelHalo: string
  /** Carte de chaleur : du plus diffus au plus dense. */
  heat: [string, string, string, string, string]
  /** Anneau du lycée sélectionné. */
  selection: string
  /** Opacité du halo des lycées bloqués / filtrants (plus forte sur fond clair). */
  glowOpacity: number
  /** Luminosité maximale des fonds raster éventuels (styles personnalisés). */
  rasterBrightness: number
}

/** Fond de carte : sombre (les foyers « brûlent ») ou clair (lisible en plein jour). */
export const MAP_BASES: Record<'dark' | 'light', MapBase> = {
  dark: {
    background: '#05070b',
    land: '#0a0d13',
    landAlt: '#0d1118',
    water: '#0a1220',
    road: '#151b26',
    boundary: '#3b4456',
    label: '#5f6878',
    labelHalo: '#05070b',
    heat: ['rgba(90,10,12,0.55)', 'rgba(180,20,27,0.75)', '#ff453a', '#ff9f0a', '#ffd60a'],
    selection: '#ffffff',
    rasterBrightness: 0.25,
    glowOpacity: 0.55,
  },
  light: {
    background: '#eef0f3',
    land: '#f6f7f9',
    landAlt: '#eceef2',
    water: '#d3dce7',
    road: '#e6e9ee',
    boundary: '#a7afbd',
    label: '#808898',
    labelHalo: '#f6f7f9',
    // Sur fond clair, la densité monte vers le rouge sombre (le jaune y serait invisible).
    heat: ['rgba(255,69,58,0.18)', 'rgba(255,69,58,0.4)', '#ff453a', '#d0241a', '#8f0f08'],
    selection: '#16181d',
    rasterBrightness: 1,
    glowOpacity: 0.85,
  },
}
