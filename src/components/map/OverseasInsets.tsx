import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Map as MapLibreMap, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import type { SchoolStatus } from '@/queries/statuses'
import { activeTerritories, type ActiveTerritory, type Bbox } from '@/lib/overseas'
import { usePanelHidden } from '@/lib/uiPrefs'
import type { Theme } from '@/lib/theme'
import { styleBase } from './baseStyle'
import { MAP_BASES, MAP_STATUS_COLORS } from './palette'

const SOURCE_ID = 'schools'
const STATUS_COLOR = [
  'match',
  ['get', 'status'],
  'bloque',
  MAP_STATUS_COLORS.bloque,
  'filtrant',
  MAP_STATUS_COLORS.filtrant,
  MAP_STATUS_COLORS.leve,
] as const

interface Props {
  statuses: ReadonlyArray<SchoolStatus>
  selectedUai: string | undefined
  onSelect: (uai: string) => void
  /** Clic ailleurs que sur un point : la carte principale se place sur le territoire. */
  onGoto: (bounds: Bbox) => void
  theme: Theme
  styleUrl: string
}

function toGeoJSON(rows: ReadonlyArray<SchoolStatus>): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: { uai: r.uai, status: r.status },
    })),
  }
}

/**
 * Médaillons des territoires d'outre-mer ayant au moins un point, par-dessus la vue nationale.
 * Chacun est une mini-carte fixe (même fond, mêmes couleurs) ; un point reste cliquable.
 */
export function OverseasInsets({
  statuses,
  selectedUai,
  onSelect,
  onGoto,
  theme,
  styleUrl,
}: Props) {
  const territories = useMemo(() => activeTerritories(statuses), [statuses])
  const [hidden, toggle] = usePanelHidden('overseas')
  if (territories.length === 0) return null
  return (
    <div className="pointer-events-none absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-2 z-[5] flex max-w-[calc(100%-1rem)] flex-col items-start gap-1.5 md:bottom-8 md:left-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!hidden}
        className="glass pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full border border-border pr-2 pl-3 text-xs font-semibold shadow-xl"
      >
        Outre-mer
        {hidden ? (
          <ChevronUp size={14} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" />
        )}
      </button>
      {!hidden && (
        <ul
          aria-label="Outre-mer : établissements avec un signal"
          className="flex flex-wrap items-end gap-1.5"
        >
          {territories.map((t) => (
            <Inset
              key={t.territory.id}
              territory={t}
              statuses={statuses}
              selectedUai={selectedUai}
              onSelect={onSelect}
              onGoto={onGoto}
              theme={theme}
              styleUrl={styleUrl}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface InsetProps extends Omit<Props, 'statuses'> {
  territory: ActiveTerritory
  statuses: ReadonlyArray<SchoolStatus>
}

function Inset({
  territory,
  statuses,
  selectedUai,
  onSelect,
  onGoto,
  theme,
  styleUrl,
}: InsetProps) {
  const { territory: info, bounds } = territory
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const rows = useMemo(
    () => statuses.filter((s) => s.department && info.departments.includes(s.department)),
    [statuses, info],
  )
  const latest = useRef({ rows, selectedUai, onSelect, onGoto, bounds, theme })
  useEffect(() => {
    latest.current = { rows, selectedUai, onSelect, onGoto, bounds, theme }
  })
  const boundsKey = bounds.join(',')

  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleUrl,
      bounds: bounds,
      fitBoundsOptions: { padding: 8 },
      attributionControl: false,
      fadeDuration: 0,
      dragRotate: false,
    })
    mapRef.current = map
    // Mini-carte fixe : on ne déplace ni ne zoome, seul le clic sur un point reste actif.
    map.dragPan.disable()
    map.scrollZoom.disable()
    map.boxZoom.disable()
    map.doubleClickZoom.disable()
    map.touchZoomRotate.disable()
    map.keyboard.disable()

    map.on('load', () => {
      map.addSource(SOURCE_ID, { type: 'geojson', data: toGeoJSON(latest.current.rows) })
      map.addLayer({
        id: 'glow',
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-color': STATUS_COLOR as never,
          'circle-radius': 11,
          'circle-blur': 1,
          'circle-opacity': ['match', ['get', 'status'], 'leve', 0.25, 0.7],
        },
      })
      map.addLayer({
        id: 'core',
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-color': STATUS_COLOR as never,
          'circle-radius': 4,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      })
      map.addLayer({
        id: 'selected',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['==', ['get', 'uai'], latest.current.selectedUai ?? ''],
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-radius': 9,
          'circle-stroke-color': MAP_BASES[latest.current.theme].selection,
          'circle-stroke-width': 2.5,
        },
      })
      // Clic sur un point : sélection ; ailleurs sur le médaillon : la carte principale s'y place.
      map.on('click', (e: MapLayerMouseEvent) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['glow', 'core'] })[0]
        const uai = hit?.properties?.uai
        if (typeof uai === 'string') latest.current.onSelect(uai)
        else latest.current.onGoto(latest.current.bounds)
      })
      for (const layer of ['glow', 'core']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = 'zoom-in'))
      }
      map.getCanvas().style.cursor = 'zoom-in'
      styleBase(map, MAP_BASES[latest.current.theme])
      readyRef.current = true
    })

    return () => {
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
    // Un médaillon est recréé seulement si son cadrage change (nouvelle île avec un signal).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, styleUrl])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) {
      styleBase(map, MAP_BASES[theme])
      map.setPaintProperty('selected', 'circle-stroke-color', MAP_BASES[theme].selection)
    }
  }, [theme])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(toGeoJSON(rows))
  }, [rows])

  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current)
      map.setFilter('selected', ['==', ['get', 'uai'], selectedUai ?? ''])
  }, [selectedUai])

  const blocked = rows.filter((r) => r.status === 'bloque').length
  const summary = `${info.label} : ${rows.length} établissement${rows.length > 1 ? 's' : ''}${blocked ? `, dont ${blocked} bloqué${blocked > 1 ? 's' : ''}` : ''}`

  return (
    <li
      aria-label={summary}
      className="glass pointer-events-auto w-[84px] overflow-hidden rounded-lg border border-border shadow-xl md:w-28"
    >
      <div ref={containerRef} className="h-[52px] w-full md:h-[72px]" />
      <p className="truncate px-1.5 py-0.5 text-[10px] leading-tight font-semibold">{info.label}</p>
    </li>
  )
}
