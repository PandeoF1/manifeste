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
import { NATIONAL_MAX_ZOOM, territoryOf } from '@/lib/overseas'
import type { Theme } from '@/lib/theme'
import { OverseasInsets } from './OverseasInsets'

setWorkerUrl(workerUrl)

const STYLE_URL =
  import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron'
const SOURCE_ID = 'schools'
/** Un signal de moins de 30 min « pulse » sur la carte. */
const RECENT_MS = 30 * 60_000
/** Durée d'une onde. */
const PULSE_MS = 2000
/** Rafale : deux ondes, puis un temps de repos (la carte ne se redessine pas pendant le repos). */
const BURST_MS = 2 * PULSE_MS
const CYCLE_MS = 8000

/** Apparition d'un point (avec un léger rebond) et disparition : durées en ms. */
const POP_MS = 600
const DEPOP_MS = 320
/** Au-delà, un saut dans le temps : les points changent d'un coup, sans animation. */
const MAX_ANIMATED = 150

/** Échelle d'un point animé (feature-state « pop ») : 1 au repos, 0 invisible, un peu plus de 1 au rebond. */
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
  /** Mobilisations signalées (niveaux du juge) : points gris cerclés de blanc. */
  mobilisation?: ReadonlyArray<SchoolStatus>
  initialView: MapViewState
  selected: SchoolStatus | undefined
  onViewChange: (view: MapViewState) => void
  onSelect: (uai: string | undefined) => void
  theme: Theme
  /** Change quand les données changent de nature (autre période, mode Historique) : pas d'animation à ce moment-là. */
  datasetKey?: string
  /** Médaillons d'outre-mer (désactivés en mode Historique : chacun est une carte de plus à redessiner). */
  overseas?: boolean
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
  return ['*', POP_ALPHA, ['match', ['get', 'status'], 'leve', 0.2, MAP_BASES[theme].glowOpacity]]
}

/** Lueur des mobilisations : celle des blocages, un peu plus discrète. */
function mobGlowOpacity(theme: Theme): ExpressionSpecification {
  return ['*', POP_ALPHA, MAP_BASES[theme].glowOpacity * 0.75]
}

/** Thème du fond et des calques dépendants, appliqué au chargement puis à chaque bascule. */
function applyTheme(map: MapLibreMap, theme: Theme) {
  styleBase(map, MAP_BASES[theme])
  if (map.getLayer('heat')) map.setPaintProperty('heat', 'heatmap-color', heatColor(theme))
  if (map.getLayer('glow')) map.setPaintProperty('glow', 'circle-opacity', glowOpacity(theme))
  if (map.getLayer('mobilisation-glow'))
    map.setPaintProperty('mobilisation-glow', 'circle-opacity', mobGlowOpacity(theme))
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
        // Bloqué dessiné au-dessus des autres.
        rank: r.status === 'bloque' ? 2 : r.status === 'filtrant' ? 1 : 0,
        // Poids dans la carte de chaleur : un lycée levé ne compte pas.
        weight: r.status === 'bloque' ? 1 : r.status === 'filtrant' ? 0.6 : 0,
        recent:
          r.status !== 'leve' &&
          !dying.has(r.uai) &&
          now - new Date(r.last_signal_at).getTime() < RECENT_MS,
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const hasRecentRef = useRef(false)
  // Points qui apparaissent ou disparaissent : ce qui est affiché, ce qui s'efface encore, les animations.
  const pops = useRef({
    shown: new Map<string, SchoolStatus>(),
    dying: new Map<string, SchoolStatus>(),
    anims: new Map<string, Anim>(),
    /** Points qui ont eu un état d'animation : à remettre à 1 s'ils reviennent sans animation. */
    touched: new Set<string>(),
    key: datasetKey,
    data: undefined as FeatureCollection<Point> | undefined,
    raf: 0,
    first: true,
  })
  const latest = useRef({ statuses, mobilisation, onViewChange, onSelect, theme })
  useEffect(() => {
    latest.current = { statuses, mobilisation, onViewChange, onSelect, theme }
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

    const anim = pops.current
    let frame = 0
    map.on('load', () => {
      addMarkerImages(map)
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        // L'identifiant du point (feature-state) est l'UAI : on y accroche l'animation.
        promoteId: 'uai',
        data: pops.current.data ?? toGeoJSON(latest.current.statuses, Date.now()),
      })

      // 1. Carte de chaleur à l'échelle nationale : rend visible l'ampleur.
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

      // 2. Halo lumineux par lycée, puis noyau brillant (effet « foyer »).
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
            'bloque',
            '#ffd2cc',
            'filtrant',
            '#ffe2b0',
            '#c9ced8',
          ],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, scaled(1.4), 8, scaled(2.6)],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, POP_ALPHA, 9, 0],
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

      // 3b. Onde d'apparition : un anneau qui part du point quand il arrive (invisible au repos).
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
        paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8, POP_ALPHA] },
        layout: {
          'icon-image': ['concat', 'status-', ['get', 'status']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 11, 0.85],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'rank'],
        },
      })

      // Mobilisations signalées : un anneau ocre translucide, assez grand pour se voir à l’échelle nationale.
      map.addSource(MOBILISATION_SOURCE, {
        type: 'geojson',
        data: mobilisationGeoJSON(latest.current.mobilisation),
      })
      // Même effet de lueur que les blocages, en ocre et un peu plus discret.
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
          // Rien à animer (aucun signal récent, onglet masqué) : on ne redessine pas la carte.
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
          // Expansion rapide puis ralentie ; l'onde s'efface complètement avant de repartir.
          const eased = 1 - (1 - phase) ** 3
          map.setPaintProperty('pulse', 'circle-radius', 6 + eased * 24)
          map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.8 * (1 - phase) ** 2)
        }
        frame = requestAnimationFrame(animate)
      }
    })

    map.on('moveend', () => {
      // Carte sans fin d'est en ouest : on ramène la longitude dans [-180, 180] pour l'adresse.
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
    // La vue initiale n'est lue qu'au montage ; ensuite la carte est la source de vérité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mobilisations signalées : simple mise à jour de la source (pas d'animation).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.getSource<GeoJSONSource>(MOBILISATION_SOURCE)?.setData(mobilisationGeoJSON(mobilisation))
  }, [mobilisation])

  // Bascule de thème à chaud (sans recharger le style).
  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) applyTheme(map, theme)
  }, [theme])

  // Mise à jour des données : les points qui arrivent apparaissent avec un rebond, ceux qui partent
  // s'effacent (ils restent dans la source le temps de l'animation).
  useEffect(() => {
    const a = pops.current
    const source = () => mapRef.current?.getSource<GeoJSONSource>(SOURCE_ID)
    const render = () => {
      const data = toGeoJSON([...a.shown.values(), ...a.dying.values()], Date.now(), a.dying)
      a.data = data
      hasRecentRef.current = data.features.some((f) => f.properties?.recent === true)
      source()?.setData(data)
    }
    // `pop` : taille du point ; `ring` : avancement de l'onde d'apparition (1 = terminée, invisible).
    const setPop = (uai: string, pop: number, ring = 1) => {
      a.touched.add(uai)
      mapRef.current?.setFeatureState({ source: SOURCE_ID, id: uai }, { pop, ring })
    }
    // Fin ou annulation d'une animation : le point retrouve sa taille normale.
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
            // Le point est déjà invisible : on le laisse à 0 jusqu'à ce qu'il ait quitté la source
            // (le retrait part dans un worker), sinon il réapparaîtrait en grand une image.
            a.anims.delete(uai)
            setPop(uai, 0)
            a.dying.delete(uai)
            gone = true
          } else settle(uai)
          continue
        }
        // « Réduire les animations » : le point grossit ou rétrécit en douceur, sans rebond ni onde.
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
    // Le premier jeu de données (le défaut est vide tant que ça charge) et un changement de nature
    // des données (autre période, Historique) s'affichent d'un coup : rien ne « naît » ni ne « meurt ».
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
        // Départ à zéro avant que le point n'entre dans la source : pas d'image à pleine taille.
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

    // Le caractère « récent » d'un signal change avec le temps : on redessine chaque minute.
    const id = window.setInterval(render, 60_000)
    return () => window.clearInterval(id)
  }, [statuses, datasetKey])

  // Sélection : repère + recentrage si le lycée est hors champ ou la vue trop large.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      map.setFilter('selected', ['==', ['get', 'uai'], selected?.uai ?? ''])
      if (!selected) return
      // Outre-mer : en vue nationale, le médaillon montre le point (le panneau s'ouvre) sans
      // déplacer la carte.
      if (territoryOf(selected.department) && map.getZoom() < NATIONAL_MAX_ZOOM) return
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
