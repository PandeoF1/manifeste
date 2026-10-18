import { useEffect, useRef } from 'react'
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  type ExpressionSpecification,
  type IControl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  setWorkerUrl,
} from 'maplibre-gl'
// MapLibre v6 derives its worker URL from import.meta.url, which Vite's bundling breaks:
// we give it the worker bundled by Vite.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { FeatureCollection, Point } from 'geojson'
import type { SchoolStatus } from '@/queries/statuses'
import { addMarkerImages } from './markerImages'
import { styleBase } from './baseStyle'
import { STYLE_URL } from './styleUrl'
import { MAP_BASES, MAP_STATUS_COLORS } from './palette'
import { NATIONAL_MAX_ZOOM, territoryOf } from '@/lib/overseas'
import { setTheme, type Theme } from '@/lib/theme'
import { OverseasInsets } from './OverseasInsets'
import { EVENT_STATUS_COLOR, routesGeoJSON, shownStatus, type MovementEvent } from '@/lib/movements'

setWorkerUrl(workerUrl)

const SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
const MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'

/** Light / dark switch as a map control: map controls are expected on the map. */
class ThemeControl implements IControl {
  private container = document.createElement('div')
  private button = document.createElement('button')

  constructor(theme: Theme) {
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    this.button.type = 'button'
    this.button.addEventListener('click', () =>
      setTheme(this.button.dataset.theme === 'dark' ? 'light' : 'dark'),
    )
    this.container.append(this.button)
    this.update(theme)
  }

  update(theme: Theme) {
    const next = theme === 'dark' ? 'clair' : 'sombre'
    this.button.dataset.theme = theme
    this.button.title = `Thème ${next}`
    this.button.setAttribute('aria-label', `Passer en thème ${next}`)
    this.button.style.display = 'grid'
    this.button.style.placeItems = 'center'
    this.button.innerHTML = theme === 'dark' ? SUN : MOON
  }

  onAdd() {
    return this.container
  }

  onRemove() {
    this.container.remove()
  }
}

const SOURCE_ID = 'schools'
/** A signal under 30 min old "pulses" on the map. */
const RECENT_MS = 30 * 60_000
/** Duration of one wave. */
const PULSE_MS = 2000
/** Burst: two waves, then a rest (the map does not redraw during the rest). */
const BURST_MS = 2 * PULSE_MS
const CYCLE_MS = 8000

/** A point appearing (with a slight bounce) and disappearing: durations in ms. */
const POP_MS = 600
const DEPOP_MS = 320
/** Beyond this, a jump in time: points change at once, without animation. */
const MAX_ANIMATED = 150

/** Scale of an animated point ("pop" feature-state): 1 at rest, 0 invisible, a bit above 1 at the bounce. */
const POP: ExpressionSpecification = ['coalesce', ['feature-state', 'pop'], 1]
const POP_ALPHA: ExpressionSpecification = ['min', 1, POP]
const RING: ExpressionSpecification = ['coalesce', ['feature-state', 'ring'], 1]
const scaled = (value: number): ExpressionSpecification => ['*', value, POP]

const easeOutBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2
const easeInCubic = (p: number) => p ** 3
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3

interface Anim {
  start: number
  out: boolean
}

export interface MapViewState {
  lat: number
  lng: number
  z: number
}

interface Props {
  statuses: ReadonlyArray<SchoolStatus>
  /** Reported mobilisations (judge tiers): grey points ringed in white. */
  mobilisation?: ReadonlyArray<SchoolStatus>
  initialView: MapViewState
  selected: SchoolStatus | undefined
  onViewChange: (view: MapViewState) => void
  onSelect: (uai: string | undefined) => void
  theme: Theme
  /** Changes when the data changes nature (another period, History mode): no animation at that moment. */
  datasetKey?: string
  /** Overseas insets (off in History mode: each one is one more map to redraw). */
  overseas?: boolean
  /** Approved marches with a route, drawn under the schools (dashed when only probable). */
  marches?: ReadonlyArray<MovementEvent>
}

function heatColor(theme: Theme): ExpressionSpecification {
  const [a, b, c, d, e] = MAP_BASES[theme].heat
  return [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,
    'rgba(0,0,0,0)',
    0.15,
    a,
    0.35,
    b,
    0.6,
    c,
    0.85,
    d,
    1,
    e,
  ]
}

function glowOpacity(theme: Theme): ExpressionSpecification {
  return ['*', POP_ALPHA, ['match', ['get', 'status'], 'lifted', 0.2, MAP_BASES[theme].glowOpacity]]
}

/** Glow of mobilisations: that of blockades, a bit more discreet. */
function mobGlowOpacity(theme: Theme): ExpressionSpecification {
  return ['*', POP_ALPHA, MAP_BASES[theme].glowOpacity * 0.75]
}

const MARCHES_SOURCE = 'marches'
/** A stable empty list: a new one at every render would redraw the source every time. */
const NO_MARCHES: ReadonlyArray<MovementEvent> = []
const MARCH_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'status'],
  'ongoing',
  EVENT_STATUS_COLOR.ongoing,
  'planned',
  EVENT_STATUS_COLOR.planned,
  EVENT_STATUS_COLOR.ended,
]
const MARCH_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  2,
  12,
  5,
  16,
  8,
]
const marchCasing = (theme: Theme) => (theme === 'dark' ? '#05070b' : '#ffffff')

/** The popup of a march: built with text nodes, the title comes from an article. */
function marchPopup(e: MovementEvent, now: Date): HTMLElement {
  const box = document.createElement('div')
  box.style.color = '#111'
  box.style.maxWidth = '16rem'
  const title = document.createElement('strong')
  title.textContent = e.title
  box.append(title)
  const line = (text: string) => {
    const p = document.createElement('div')
    p.style.fontSize = '0.8rem'
    p.textContent = text
    box.append(p)
  }
  const status = shownStatus(e, now)
  const when = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(e.startsAt)
  line(`${e.place ? `${e.place} · ` : ''}${when}`)
  line(status === 'ongoing' ? 'En cours' : status === 'planned' ? 'À venir' : 'Terminé')
  if (e.routeBasis === 'probable') line('Parcours probable, calculé d’après la presse : à vérifier')
  if (e.sourceUrl?.startsWith('https://')) {
    const a = document.createElement('a')
    a.href = e.sourceUrl
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = e.sourceDomain ?? 'Source'
    a.style.fontSize = '0.8rem'
    box.append(a)
  }
  return box
}

/** Theme of the background and dependent layers, applied on load then on every switch. */
function applyTheme(map: MapLibreMap, theme: Theme) {
  styleBase(map, MAP_BASES[theme])
  if (map.getLayer('heat')) map.setPaintProperty('heat', 'heatmap-color', heatColor(theme))
  if (map.getLayer('glow')) map.setPaintProperty('glow', 'circle-opacity', glowOpacity(theme))
  if (map.getLayer('mobilisation-glow'))
    map.setPaintProperty('mobilisation-glow', 'circle-opacity', mobGlowOpacity(theme))
  if (map.getLayer('selected'))
    map.setPaintProperty('selected', 'circle-stroke-color', MAP_BASES[theme].selection)
  // styleBase recolours every line layer as a road: the marches are painted again after it.
  for (const id of ['march-announced', 'march-probable'])
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', MARCH_COLOR)
  if (map.getLayer('march-casing'))
    map.setPaintProperty('march-casing', 'line-color', marchCasing(theme))
}

const STATUS_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'status'],
  'blocked',
  MAP_STATUS_COLORS.blocked,
  'filtering',
  MAP_STATUS_COLORS.filtering,
  MAP_STATUS_COLORS.lifted,
]

function toGeoJSON(
  rows: ReadonlyArray<SchoolStatus>,
  now: number,
  dying: ReadonlyMap<string, unknown> = new Map(),
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        uai: r.uai,
        status: r.status,
        // Blocked drawn above the others.
        rank: r.status === 'blocked' ? 2 : r.status === 'filtering' ? 1 : 0,
        // Weight in the heat map: a lifted school does not count.
        weight: r.status === 'blocked' ? 1 : r.status === 'filtering' ? 0.6 : 0,
        recent:
          r.status !== 'lifted' &&
          !dying.has(r.uai) &&
          now - new Date(r.lastSignalAt).getTime() < RECENT_MS,
      },
    })),
  }
}

const MOBILISATION_SOURCE = 'mobilisation'

function mobilisationGeoJSON(rows: ReadonlyArray<SchoolStatus>): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: { uai: r.uai },
    })),
  }
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function MapView({
  statuses,
  mobilisation = [],
  initialView,
  selected,
  onViewChange,
  onSelect,
  theme,
  overseas = true,
  datasetKey = '',
  marches = NO_MARCHES,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const hasRecentRef = useRef(false)
  // Points appearing or disappearing: what is shown, what is still fading out, the animations.
  const pops = useRef({
    shown: new Map<string, SchoolStatus>(),
    dying: new Map<string, SchoolStatus>(),
    anims: new Map<string, Anim>(),
    /** Points that had an animation state: reset to 1 if they come back without animation. */
    touched: new Set<string>(),
    key: datasetKey,
    data: undefined as FeatureCollection<Point> | undefined,
    raf: 0,
    first: true,
  })
  const themeControlRef = useRef<ThemeControl | null>(null)
  const latest = useRef({ statuses, mobilisation, marches, onViewChange, onSelect, theme })
  useEffect(() => {
    latest.current = { statuses, mobilisation, marches, onViewChange, onSelect, theme }
  })

  // One-time creation of the map.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: [initialView.lng, initialView.lat],
      zoom: initialView.z,
      minZoom: 3,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    // The style is the light positron one: recolour it as soon as its layers exist, before the
    // first tiles are drawn, so a dark theme never flashes the light map ('load' comes later).
    map.once('style.load', () => styleBase(map, MAP_BASES[latest.current.theme]))
    map.touchZoomRotate.disableRotation()
    // Bottom right, away from the Report button and the menu. Bottom controls stack upwards:
    // the last one added is the top one (theme, zoom, then geolocation at the bottom).
    // Geolocation: computed in the browser, never sent to the server. On the phone it stays at the
    // top: the bottom right belongs to the Report button.
    const desktop = window.matchMedia('(min-width: 768px)').matches
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
      }),
      desktop ? 'bottom-right' : 'top-right',
    )
    // Phone: pinch to zoom, no +/- buttons cluttering the screen; the theme switch stays in the top bar.
    if (desktop) {
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
      const themeControl = new ThemeControl(latest.current.theme)
      themeControlRef.current = themeControl
      map.addControl(themeControl, 'bottom-right')
    }

    const anim = pops.current
    let frame = 0
    map.on('load', () => {
      addMarkerImages(map)
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        // The point id (feature-state) is the UAI: the animation hangs on it.
        promoteId: 'uai',
        data: pops.current.data ?? toGeoJSON(latest.current.statuses, Date.now()),
      })

      // Marches, under everything else: a solid line when the route is announced, a dashed and
      // lighter one when it is only probable (a hypothesis, never read as the real route).
      map.addSource(MARCHES_SOURCE, {
        type: 'geojson',
        data: routesGeoJSON(latest.current.marches, new Date()),
      })
      map.addLayer({
        id: 'march-casing',
        type: 'line',
        source: MARCHES_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': marchCasing(latest.current.theme),
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 9, 16, 13],
          'line-opacity': 0.8,
        },
      })
      map.addLayer({
        id: 'march-announced',
        type: 'line',
        source: MARCHES_SOURCE,
        filter: ['==', ['get', 'basis'], 'announced'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': MARCH_COLOR, 'line-width': MARCH_WIDTH },
      })
      map.addLayer({
        id: 'march-probable',
        type: 'line',
        source: MARCHES_SOURCE,
        filter: ['==', ['get', 'basis'], 'probable'],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': MARCH_COLOR,
          'line-width': MARCH_WIDTH,
          'line-dasharray': [1.2, 1.4],
          'line-opacity': 0.85,
        },
      })
      for (const layer of ['march-announced', 'march-probable']) {
        map.on('click', layer, (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id
          const march = latest.current.marches.find((m) => m.id === id)
          if (!march) return
          new Popup({ closeButton: true, maxWidth: '18rem' })
            .setLngLat(e.lngLat)
            .setDOMContent(marchPopup(march, new Date()))
            .addTo(map)
        })
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }

      // 1. National-scale heat map: shows the scale of the movement.
      map.addLayer({
        id: 'heat',
        type: 'heatmap',
        source: SOURCE_ID,
        maxzoom: 10,
        paint: {
          'heatmap-weight': ['*', ['get', 'weight'], POP_ALPHA],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 9, 2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 6, 26, 9, 40],
          'heatmap-color': heatColor(latest.current.theme),
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.85, 10, 0],
        },
      })

      // 2. Glowing halo per school, then a bright core ("hotspot" effect).
      map.addLayer({
        id: 'glow',
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-color': STATUS_COLOR,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3,
            scaled(6),
            8,
            scaled(14),
            13,
            scaled(24),
          ],
          'circle-blur': 1,
          'circle-opacity': glowOpacity(latest.current.theme),
        },
      })
      map.addLayer({
        id: 'core',
        type: 'circle',
        source: SOURCE_ID,
        maxzoom: 9,
        paint: {
          'circle-color': [
            'match',
            ['get', 'status'],
            'blocked',
            '#ffd2cc',
            'filtering',
            '#ffe2b0',
            '#c9ced8',
          ],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, scaled(1.4), 8, scaled(2.6)],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, POP_ALPHA, 9, 0],
        },
      })

      // 3. Wave pulsing on signals under 30 min old.
      map.addLayer({
        id: 'pulse',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'recent'], true],
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': STATUS_COLOR,
          'circle-stroke-width': 2,
          'circle-radius': 6,
          'circle-stroke-opacity': 0,
          // Animated frame by frame: otherwise MapLibre smooths every change over 300 ms and
          // the wave, always late, visibly shrinks back as it restarts from zero.
          'circle-radius-transition': { duration: 0, delay: 0 },
          'circle-stroke-opacity-transition': { duration: 0, delay: 0 },
        },
      })

      // 3b. Appearance wave: a ring leaving the point when it arrives (invisible at rest).
      map.addLayer({
        id: 'spawn',
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': STATUS_COLOR,
          'circle-stroke-width': 2,
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            3,
            ['+', 4, ['*', RING, 14]],
            8,
            ['+', 6, ['*', RING, 26]],
            13,
            ['+', 8, ['*', RING, 40]],
          ],
          'circle-stroke-opacity': ['*', 0.9, ['-', 1, RING]],
          'circle-radius-transition': { duration: 0, delay: 0 },
          'circle-stroke-opacity-transition': { duration: 0, delay: 0 },
        },
      })

      // 4. Selection marker.
      map.addLayer({
        id: 'selected',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'uai'], ''],
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 10, 12, 20],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      })

      // 5. Status shape (accessibility: not colour alone).
      map.addLayer({
        id: 'schools',
        type: 'symbol',
        source: SOURCE_ID,
        // National view: only the glowing hotspots; shapes appear when zooming in
        // (and are always available in the list and the legend).
        minzoom: 7,
        paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8, POP_ALPHA] },
        layout: {
          'icon-image': ['concat', 'status-', ['get', 'status']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 11, 0.85],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'rank'],
        },
      })

      // Reported mobilisations: a translucent ochre ring, large enough to be seen at national scale.
      map.addSource(MOBILISATION_SOURCE, {
        type: 'geojson',
        data: mobilisationGeoJSON(latest.current.mobilisation),
      })
      // Same glow effect as blockades, in ochre and a bit more discreet.
      map.addLayer(
        {
          id: 'mobilisation-glow',
          type: 'circle',
          source: MOBILISATION_SOURCE,
          paint: {
            'circle-color': '#e6b93a',
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              3,
              scaled(5),
              8,
              scaled(11),
              13,
              scaled(18),
            ],
            'circle-blur': 1,
            'circle-opacity': mobGlowOpacity(latest.current.theme),
          },
        },
        'selected',
      )
      map.addLayer(
        {
          id: 'mobilisation-dots',
          type: 'circle',
          source: MOBILISATION_SOURCE,
          paint: {
            'circle-color': '#e6b93a',
            'circle-opacity': 0.3,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, scaled(2.6), 9, scaled(5.5)],
            'circle-stroke-color': '#c99a1c',
            'circle-stroke-width': 1.6,
            'circle-stroke-opacity': 0.95,
          },
        },
        'selected',
      )

      for (const layer of ['schools', 'glow', 'core', 'mobilisation-dots']) {
        map.on('click', layer, (e: MapLayerMouseEvent) => {
          const uai = e.features?.[0]?.properties?.uai
          if (typeof uai === 'string') latest.current.onSelect(uai)
        })
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }

      applyTheme(map, latest.current.theme)
      readyRef.current = true

      if (!prefersReducedMotion()) {
        let last = 0
        let resting = false
        const animate = (t: number) => {
          frame = requestAnimationFrame(animate)
          // Nothing to animate (no recent signal, tab hidden): the map is not redrawn.
          if (!hasRecentRef.current || document.hidden) return
          const inCycle = t % CYCLE_MS
          if (inCycle >= BURST_MS) {
            if (!resting) {
              resting = true
              map.setPaintProperty('pulse', 'circle-stroke-opacity', 0)
            }
            return
          }
          resting = false
          if (t - last < 33) return // ~30 i/s suffit
          last = t
          const phase = (inCycle % PULSE_MS) / PULSE_MS
          // Fast expansion then slowing down; the wave fades out completely before restarting.
          const eased = 1 - (1 - phase) ** 3
          map.setPaintProperty('pulse', 'circle-radius', 6 + eased * 24)
          map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.8 * (1 - phase) ** 2)
        }
        frame = requestAnimationFrame(animate)
      }
    })

    map.on('moveend', () => {
      // The map wraps endlessly east to west: bring the longitude back into [-180, 180] for the address.
      const c = map.getCenter().wrap()
      latest.current.onViewChange({
        lat: Math.round(c.lat * 1e4) / 1e4,
        lng: Math.round(c.lng * 1e4) / 1e4,
        z: Math.round(map.getZoom() * 100) / 100,
      })
    })

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(anim.raf)
      anim.raf = 0
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
    // The initial view is only read on mount; after that the map is the source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Marches: a plain source update.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.getSource<GeoJSONSource>(MARCHES_SOURCE)?.setData(routesGeoJSON(marches, new Date()))
  }, [marches])

  // Reported mobilisations: a plain source update (no animation).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.getSource<GeoJSONSource>(MOBILISATION_SOURCE)?.setData(mobilisationGeoJSON(mobilisation))
  }, [mobilisation])

  // Live theme switch (without reloading the style).
  useEffect(() => {
    themeControlRef.current?.update(theme)
    const map = mapRef.current
    if (map && readyRef.current) applyTheme(map, theme)
  }, [theme])

  // Data update: points arriving appear with a bounce, those leaving
  // fade out (they stay in the source for the duration of the animation).
  useEffect(() => {
    const a = pops.current
    const source = () => mapRef.current?.getSource<GeoJSONSource>(SOURCE_ID)
    const render = () => {
      const data = toGeoJSON([...a.shown.values(), ...a.dying.values()], Date.now(), a.dying)
      a.data = data
      hasRecentRef.current = data.features.some((f) => f.properties?.recent === true)
      source()?.setData(data)
    }
    // `pop`: size of the point; `ring`: progress of the appearance wave (1 = done, invisible).
    const setPop = (uai: string, pop: number, ring = 1) => {
      a.touched.add(uai)
      mapRef.current?.setFeatureState({ source: SOURCE_ID, id: uai }, { pop, ring })
    }
    // End or cancellation of an animation: the point returns to its normal size.
    const settle = (uai: string) => {
      a.anims.delete(uai)
      if (a.touched.has(uai) && source()) setPop(uai, 1)
    }
    const reduced = prefersReducedMotion()
    const tick = () => {
      const map = mapRef.current
      if (!map || !source()) {
        a.raf = 0
        return
      }
      const now = performance.now()
      let gone = false
      for (const [uai, anim] of a.anims) {
        const p = (now - anim.start) / (anim.out ? DEPOP_MS : POP_MS)
        if (p >= 1) {
          if (anim.out) {
            // The point is already invisible: leave it at 0 until it has left the source
            // (removal happens in a worker), otherwise it would reappear full-size for one frame.
            a.anims.delete(uai)
            setPop(uai, 0)
            a.dying.delete(uai)
            gone = true
          } else settle(uai)
          continue
        }
        // "Reduce motion": the point grows or shrinks smoothly, without bounce or wave.
        if (anim.out) setPop(uai, 1 - easeInCubic(p))
        else if (reduced) setPop(uai, easeOutCubic(p))
        else setPop(uai, easeOutBack(p), easeOutCubic(p))
      }
      if (gone) render()
      a.raf = a.anims.size > 0 ? requestAnimationFrame(tick) : 0
    }

    const next = new Map(statuses.map((s) => [s.uai, s]))
    const added = [...next.keys()].filter((uai) => !a.shown.has(uai))
    const removed = [...a.shown.values()].filter((s) => !next.has(s.uai))
    // The first data set (the default is empty while loading) and a change in the nature
    // of the data (another period, History) display at once: nothing is "born" or "dies".
    const switched = a.key !== datasetKey
    a.key = datasetKey
    const initial = a.first
    if (next.size > 0) a.first = false
    if (switched) {
      for (const uai of [...a.anims.keys()]) settle(uai)
      a.dying.clear()
    }
    const animate =
      !initial && !switched && readyRef.current && added.length + removed.length <= MAX_ANIMATED
    const now = performance.now()
    for (const uai of added) {
      a.dying.delete(uai)
      settle(uai)
      if (animate) {
        // Start at zero before the point enters the source: no full-size frame.
        setPop(uai, 0, reduced ? 1 : 0)
        a.anims.set(uai, { start: now, out: false })
      }
    }
    for (const row of removed) {
      settle(row.uai)
      if (animate) {
        a.dying.set(row.uai, row)
        a.anims.set(row.uai, { start: now, out: true })
      } else a.dying.delete(row.uai)
    }
    a.shown = next
    render()
    if (a.anims.size > 0 && !a.raf) a.raf = requestAnimationFrame(tick)

    // Whether a signal is "recent" changes with time: redraw every minute.
    const id = window.setInterval(render, 60_000)
    return () => window.clearInterval(id)
  }, [statuses, datasetKey])

  // Selection: marker + recentre if the school is out of view or the view too wide.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      map.setFilter('selected', ['==', ['get', 'uai'], selected?.uai ?? ''])
      if (!selected) return
      // Overseas: in national view, the inset shows the point (the panel opens) without
      // moving the map.
      if (territoryOf(selected.department) && map.getZoom() < NATIONAL_MAX_ZOOM) return
      const inView = map.getBounds().contains([selected.lng, selected.lat])
      if (!inView || map.getZoom() < 8) {
        map.flyTo({
          center: [selected.lng, selected.lat],
          zoom: Math.max(map.getZoom(), 11),
          duration: prefersReducedMotion() ? 0 : 1200,
          // Leave room for the panel at the bottom on mobile.
          padding: window.innerWidth < 768 ? { bottom: window.innerHeight * 0.4 } : undefined,
        })
      }
    }
    if (readyRef.current) apply()
    else map.once('load', apply)
  }, [selected])

  return (
    // Separate positioned container: MapLibre's CSS forces position: relative on .maplibregl-map.
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ backgroundColor: MAP_BASES[theme].background }}
        role="region"
        aria-label="Carte des lycées et des facs concernés. Une liste textuelle est disponible à côté de la carte."
      />
      {overseas && (
        <OverseasInsets
          statuses={statuses}
          selectedUai={selected?.uai}
          onSelect={onSelect}
          onGoto={(bounds) =>
            mapRef.current?.fitBounds(bounds, {
              padding: 40,
              maxZoom: 10,
              duration: prefersReducedMotion() ? 0 : 1200,
            })
          }
          theme={theme}
          styleUrl={STYLE_URL}
        />
      )}
    </div>
  )
}
