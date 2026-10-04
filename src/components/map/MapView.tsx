import { useEffect, useRef } from 'react'
import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
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

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
const SOURCE_ID = 'schools'

setWorkerUrl(workerUrl)

export interface MapViewState {
  lat: number
  lng: number
  z: number
}

interface Props {
  statuses: ReadonlyArray<SchoolStatus>
  view: MapViewState
  onViewChange: (view: MapViewState) => void
  onSelect: (uai: string | undefined) => void
}

function toGeoJSON(rows: ReadonlyArray<SchoolStatus>): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      id: r.uai,
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      // Priorité d'affichage : bloqué au-dessus.
      properties: {
        uai: r.uai,
        status: r.status,
        rank: r.status === 'bloque' ? 0 : r.status === 'filtrant' ? 1 : 2,
      },
    })),
  }
}

export function MapView({ statuses, view, onViewChange, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const latest = useRef({ statuses, onViewChange, onSelect })
  useEffect(() => {
    latest.current = { statuses, onViewChange, onSelect }
  })

  // Création unique de la carte.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: [view.lng, view.lat],
      zoom: view.z,
      attributionControl: { compact: true },
      maxBounds: [
        [-70, -25],
        [60, 55],
      ],
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    // Géolocalisation : calculée dans le navigateur, jamais envoyée au serveur.
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
      }),
      'top-right',
    )

    map.on('load', () => {
      addMarkerImages(map)
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: toGeoJSON(latest.current.statuses),
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 11,
        clusterProperties: {
          bloque: ['+', ['case', ['==', ['get', 'status'], 'bloque'], 1, 0]],
        },
      })
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['case', ['>', ['get', 'bloque'], 0], '#c0261f', '#5f6673'],
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
        },
        paint: { 'text-color': '#ffffff' },
      })
      map.addLayer({
        id: 'schools',
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['concat', 'status-', ['get', 'status']],
          'icon-allow-overlap': true,
          'symbol-sort-key': ['get', 'rank'],
        },
      })

      map.on('click', 'schools', (e: MapLayerMouseEvent) => {
        const uai = e.features?.[0]?.properties?.uai
        if (typeof uai === 'string') latest.current.onSelect(uai)
      })
      map.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        const clusterId = feature?.properties?.cluster_id
        if (!feature || typeof clusterId !== 'number' || feature.geometry.type !== 'Point') return
        const source = map.getSource<GeoJSONSource>(SOURCE_ID)
        const zoom = await source?.getClusterExpansionZoom(clusterId)
        if (zoom == null) return
        map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom })
      })
      for (const layer of ['schools', 'clusters']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
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

    // Recalcule les couleurs des marqueurs si le thème système change.
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => map.loaded() && addMarkerImages(map)
    media.addEventListener('change', onTheme)

    return () => {
      media.removeEventListener('change', onTheme)
      map.remove()
      mapRef.current = null
    }
    // La vue initiale n'est lue qu'au montage ; ensuite la carte est la source de vérité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mise à jour des données.
  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(SOURCE_ID)
    source?.setData(toGeoJSON(statuses))
  }, [statuses])

  return (
    // Conteneur positionné séparé : le CSS de MapLibre impose position: relative à .maplibregl-map.
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label="Carte des lycées concernés. Une liste textuelle est disponible via le bouton Liste."
      />
    </div>
  )
}
