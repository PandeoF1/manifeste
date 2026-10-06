import { useEffect, useRef } from 'react'
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  setWorkerUrl,
} from 'maplibre-gl'
// MapLibre v6 déduit l'URL de son worker de import.meta.url, ce que le bundling de Vite casse :
// on lui fournit le worker bundlé par Vite.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { FeatureCollection, Point } from 'geojson'
import type { SchoolStatus } from '@/queries/statuses'
import { addMarkerImages } from './markerImages'
import { styleBase } from './baseStyle'
import { MAP_BASES, MAP_STATUS_COLORS } from './palette'
import type { Theme } from '@/lib/theme'

setWorkerUrl(workerUrl)

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
const SOURCE_ID = 'schools'
/** Un signal de moins de 30 min « pulse » sur la carte. */
const RECENT_MS = 30 * 60_000
/** Durée d'une onde. */
const PULSE_MS = 2000

export interface MapViewState {
  lat: number
  lng: number
  z: number
}

interface Props {
  statuses: ReadonlyArray<SchoolStatus>
  initialView: MapViewState
  selected: SchoolStatus | undefined
  onViewChange: (view: MapViewState) => void
  onSelect: (uai: string | undefined) => void
  theme: Theme
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

/** Thème du fond et des calques dépendants, appliqué au chargement puis à chaque bascule. */
function applyTheme(map: MapLibreMap, theme: Theme) {
  styleBase(map, MAP_BASES[theme])
  if (map.getLayer('heat')) map.setPaintProperty('heat', 'heatmap-color', heatColor(theme))
  if (map.getLayer('glow'))
    map.setPaintProperty('glow', 'circle-opacity', [
      'match',
      ['get', 'status'],
      'leve',
      0.2,
      MAP_BASES[theme].glowOpacity,
    ])
  if (map.getLayer('selected'))
    map.setPaintProperty('selected', 'circle-stroke-color', MAP_BASES[theme].selection)
}

const STATUS_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'status'],
  'bloque',
  MAP_STATUS_COLORS.bloque,
  'filtrant',
  MAP_STATUS_COLORS.filtrant,
  MAP_STATUS_COLORS.leve,
]

function toGeoJSON(rows: ReadonlyArray<SchoolStatus>, now: number): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        uai: r.uai,
        status: r.status,
        // Bloqué dessiné au-dessus des autres.
        rank: r.status === 'bloque' ? 2 : r.status === 'filtrant' ? 1 : 0,
        // Poids dans la carte de chaleur : un lycée levé ne compte pas.
        weight: r.status === 'bloque' ? 1 : r.status === 'filtrant' ? 0.6 : 0,
        recent: r.status !== 'leve' && now - new Date(r.last_signal_at).getTime() < RECENT_MS,
      },
    })),
  }
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function MapView({
  statuses,
  initialView,
  selected,
  onViewChange,
  onSelect,
  theme,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const hasRecentRef = useRef(false)
  const latest = useRef({ statuses, onViewChange, onSelect, theme })
  useEffect(() => {
    latest.current = { statuses, onViewChange, onSelect, theme }
  })

  // Création unique de la carte.
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
      maxBounds: [
        [-70, -25],
        [60, 55],
      ],
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    // Téléphone : zoom au doigt, pas de boutons +/- qui encombrent l'écran.
    if (window.matchMedia('(min-width: 768px)').matches)
      map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    // Géolocalisation : calculée dans le navigateur, jamais envoyée au serveur.
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
      }),
      'top-right',
    )

    let frame = 0
    map.on('load', () => {
      addMarkerImages(map)
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toGeoJSON(latest.current.statuses, Date.now()),
      })

      // 1. Carte de chaleur à l'échelle nationale : rend visible l'ampleur.
      map.addLayer({
        id: 'heat',
        type: 'heatmap',
        source: SOURCE_ID,
        maxzoom: 10,
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 9, 2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 6, 26, 9, 40],
          'heatmap-color': heatColor(latest.current.theme),
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.85, 10, 0],
        },
      })

      // 2. Halo lumineux par lycée, puis noyau brillant (effet « foyer »).
      map.addLayer({
        id: 'glow',
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-color': STATUS_COLOR,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 8, 14, 13, 24],
          'circle-blur': 1,
          'circle-opacity': ['match', ['get', 'status'], 'leve', 0.2, 0.55],
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
            'bloque',
            '#ffd2cc',
            'filtrant',
            '#ffe2b0',
            '#c9ced8',
          ],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 8, 2.6],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 1, 9, 0],
        },
      })

      // 3. Onde qui pulse sur les signaux de moins de 30 min.
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
          // Animé image par image : sans ça, MapLibre lisse chaque changement sur 300 ms et
          // l'onde, toujours en retard, se rétracte visiblement en repartant de zéro.
          'circle-radius-transition': { duration: 0, delay: 0 },
          'circle-stroke-opacity-transition': { duration: 0, delay: 0 },
        },
      })

      // 4. Repère de sélection.
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

      // 5. Forme du statut (accessibilité : pas la couleur seule).
      map.addLayer({
        id: 'schools',
        type: 'symbol',
        source: SOURCE_ID,
        // Vue nationale : seulement les foyers lumineux ; les formes apparaissent en zoomant
        // (et restent toujours disponibles dans la liste et la légende).
        minzoom: 7,
        paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8, 1] },
        layout: {
          'icon-image': ['concat', 'status-', ['get', 'status']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 11, 0.85],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'rank'],
        },
      })

      for (const layer of ['schools', 'glow', 'core']) {
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
        const animate = (t: number) => {
          frame = requestAnimationFrame(animate)
          // Rien à animer (aucun signal récent, onglet masqué) : on ne redessine pas la carte.
          if (!hasRecentRef.current || document.hidden) return
          if (t - last < 33) return // ~30 i/s suffit
          last = t
          const phase = (t % PULSE_MS) / PULSE_MS
          // Expansion rapide puis ralentie ; l'onde s'efface complètement avant de repartir.
          const eased = 1 - (1 - phase) ** 3
          map.setPaintProperty('pulse', 'circle-radius', 6 + eased * 24)
          map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.8 * (1 - phase) ** 2)
        }
        frame = requestAnimationFrame(animate)
      }
    })

    map.on('moveend', () => {
      const c = map.getCenter()
      latest.current.onViewChange({
        lat: Math.round(c.lat * 1e4) / 1e4,
        lng: Math.round(c.lng * 1e4) / 1e4,
        z: Math.round(map.getZoom() * 100) / 100,
      })
    })

    return () => {
      cancelAnimationFrame(frame)
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
    // La vue initiale n'est lue qu'au montage ; ensuite la carte est la source de vérité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Bascule de thème à chaud (sans recharger le style).
  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) applyTheme(map, theme)
  }, [theme])

  // Mise à jour des données (et du caractère « récent » des signaux).
  useEffect(() => {
    const update = () => {
      const data = toGeoJSON(statuses, Date.now())
      hasRecentRef.current = data.features.some((f) => f.properties?.recent === true)
      mapRef.current?.getSource<GeoJSONSource>(SOURCE_ID)?.setData(data)
    }
    update()
    const id = window.setInterval(update, 60_000)
    return () => window.clearInterval(id)
  }, [statuses])

  // Sélection : repère + recentrage si le lycée est hors champ ou la vue trop large.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      map.setFilter('selected', ['==', ['get', 'uai'], selected?.uai ?? ''])
      if (!selected) return
      const inView = map.getBounds().contains([selected.lng, selected.lat])
      if (!inView || map.getZoom() < 8) {
        map.flyTo({
          center: [selected.lng, selected.lat],
          zoom: Math.max(map.getZoom(), 11),
          duration: prefersReducedMotion() ? 0 : 1200,
          // Laisse la place au panneau en bas sur mobile.
          padding: window.innerWidth < 768 ? { bottom: window.innerHeight * 0.4 } : undefined,
        })
      }
    }
    if (readyRef.current) apply()
    else map.once('load', apply)
  }, [selected])

  return (
    // Conteneur positionné séparé : le CSS de MapLibre impose position: relative à .maplibregl-map.
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label="Carte des lycées et des facs concernés. Une liste textuelle est disponible à côté de la carte."
      />
    </div>
  )
}
