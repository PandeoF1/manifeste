import { useEffect, useRef } from 'react'
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
// Same bundled worker as the home map (see MapView).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { styleBase } from '@/components/map/baseStyle'
import { MAP_BASES } from '@/components/map/palette'
import { STYLE_URL } from '@/components/map/styleUrl'
import {
  boundsOf,
  EVENT_STATUS_COLOR,
  pointsGeoJSON,
  routesGeoJSON,
  type MovementEvent,
} from '@/lib/movements'
import type { Theme } from '@/lib/theme'

setWorkerUrl(workerUrl)

const ROUTES = 'routes'
const POINTS = 'event-points'

const COLOR: ExpressionSpecification = [
  'match',
  ['get', 'status'],
  'ongoing',
  EVENT_STATUS_COLOR.ongoing,
  'planned',
  EVENT_STATUS_COLOR.planned,
  EVENT_STATUS_COLOR.ended,
]
const WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 5, 16, 8]
const CASING: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 9, 16, 13]
/** France, when there is nothing to frame. */
const FRANCE: [number, number] = [2.5, 46.6]

const casingColor = (theme: Theme) => (theme === 'dark' ? '#05070b' : '#ffffff')

/**
 * Basemap colours for the theme. styleBase recolours every line layer as a road, so our own
 * lines are painted again right after it: the order matters.
 */
function applyTheme(map: MapLibreMap, theme: Theme) {
  styleBase(map, MAP_BASES[theme])
  for (const id of ['route-announced', 'route-probable'])
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', COLOR)
  if (map.getLayer('route-casing'))
    map.setPaintProperty('route-casing', 'line-color', casingColor(theme))
  if (map.getLayer('route-selected'))
    map.setPaintProperty('route-selected', 'line-color', MAP_BASES[theme].selection)
  if (map.getLayer(POINTS))
    map.setPaintProperty(POINTS, 'circle-stroke-color', MAP_BASES[theme].selection)
}

interface Props {
  events: ReadonlyArray<MovementEvent>
  now: Date
  theme: Theme
  selectedId: string | undefined
  onSelect: (id: string | undefined) => void
  /** Reframes when it changes (the movement shown). */
  datasetKey: string
}

/**
 * The map of one movement: every event with a route is drawn as a line (solid when the route is
 * announced, dashed when it is only probable), every event as a point. Colour = status now.
 */
export default function MovementMap({
  events,
  now,
  theme,
  selectedId,
  onSelect,
  datasetKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const latest = useRef({ events, now, theme, selectedId, onSelect })
  // Read by the map's event handlers, which outlive a render.
  useEffect(() => {
    latest.current = { events, now, theme, selectedId, onSelect }
  })
  const framedRef = useRef<string | null>(null)

  const whenReady = (run: (map: MapLibreMap) => void) => {
    const map = mapRef.current
    if (!map) return
    if (readyRef.current) run(map)
    else map.once('load', () => run(map))
  }

  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: FRANCE,
      zoom: 5,
      minZoom: 3,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    if (window.matchMedia('(min-width: 768px)').matches)
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')

    map.on('load', () => {
      const { events: evs, now: at, theme: th, selectedId: sel } = latest.current
      map.addSource(ROUTES, { type: 'geojson', data: routesGeoJSON(evs, at) })
      map.addSource(POINTS, { type: 'geojson', data: pointsGeoJSON(evs, at) })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: ROUTES,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': casingColor(th), 'line-width': CASING, 'line-opacity': 0.85 },
      })
      map.addLayer({
        id: 'route-announced',
        type: 'line',
        source: ROUTES,
        filter: ['==', ['get', 'basis'], 'announced'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLOR, 'line-width': WIDTH },
      })
      // A probable route is a hypothesis: dashed and lighter, so it is never read as the real one.
      map.addLayer({
        id: 'route-probable',
        type: 'line',
        source: ROUTES,
        filter: ['==', ['get', 'basis'], 'probable'],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': COLOR,
          'line-width': WIDTH,
          'line-dasharray': [1.2, 1.4],
          'line-opacity': 0.8,
        },
      })
      map.addLayer(
        {
          id: 'route-selected',
          type: 'line',
          source: ROUTES,
          filter: ['==', ['get', 'id'], sel ?? ''],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': MAP_BASES[th].selection,
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 12, 12, 16, 18],
            'line-opacity': 0.5,
          },
        },
        // Under the lines: a halo, not a veil over the colour.
        'route-announced',
      )
      map.addLayer({
        id: POINTS,
        type: 'circle',
        source: POINTS,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 12, 8],
          'circle-color': COLOR,
          'circle-stroke-width': 2,
          'circle-stroke-color': MAP_BASES[th].selection,
        },
      })
      applyTheme(map, th)
      readyRef.current = true
    })

    const hit = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      latest.current.onSelect(typeof id === 'string' ? id : undefined)
    }
    for (const layer of [POINTS, 'route-announced', 'route-probable']) {
      map.on('click', layer, hit)
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    return () => {
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Data: the lines and points follow the events and the clock (a march turns "ongoing").
  useEffect(() => {
    whenReady((map) => {
      map.getSource<GeoJSONSource>(ROUTES)?.setData(routesGeoJSON(events, now))
      map.getSource<GeoJSONSource>(POINTS)?.setData(pointsGeoJSON(events, now))
    })
  }, [events, now])

  // Frame the whole movement once per movement, as soon as there is something to frame.
  useEffect(() => {
    const box = boundsOf(events)
    if (!box || framedRef.current === datasetKey) return
    framedRef.current = datasetKey
    whenReady((map) =>
      map.fitBounds(
        [
          [box[0], box[1]],
          [box[2], box[3]],
        ],
        { padding: 60, maxZoom: 12, duration: 0 },
      ),
    )
  }, [events, datasetKey])

  // Selection: highlight the route and bring the event into view.
  useEffect(() => {
    whenReady((map) => {
      map.setFilter('route-selected', ['==', ['get', 'id'], selectedId ?? ''])
      const chosen = events.find((e) => e.id === selectedId)
      const box = chosen ? boundsOf([chosen]) : null
      if (!box) return
      map.fitBounds(
        [
          [box[0], box[1]],
          [box[2], box[3]],
        ],
        { padding: 70, maxZoom: 15, duration: 800 },
      )
    })
    // `events` is deliberately left out: new data must not move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Theme: recolour the basemap and our layers live.
  useEffect(() => {
    whenReady((map) => applyTheme(map, theme))
  }, [theme])

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label="Carte des événements du mouvement. La liste des événements est à côté."
      />
    </div>
  )
}
