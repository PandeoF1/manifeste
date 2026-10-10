import type { Map as MapLibreMap } from 'maplibre-gl'
import type { MapBase } from './palette'

/**
 * Recolours any vector style (OpenFreeMap positron by default) on the fly, in
 * dark or light: we keep the geography (coasts, borders, towns) but everything moves to the
 * background, so that only the signals stand out. Every property is set explicitly:
 * the theme can be switched live, without reloading the style.
 */
export function styleBase(map: MapLibreMap, MAP_BASE: MapBase) {
  const layers = map.getStyle().layers ?? []
  for (const layer of layers) {
    const id = layer.id.toLowerCase()
    const set = (
      prop: Parameters<MapLibreMap['setPaintProperty']>[1],
      value: Parameters<MapLibreMap['setPaintProperty']>[2],
    ) => {
      try {
        map.setPaintProperty(layer.id, prop, value)
      } catch {
        // property absent for this layer type
      }
    }
    switch (layer.type) {
      case 'background':
        set('background-color', MAP_BASE.background)
        break
      case 'fill':
        set('fill-pattern', undefined)
        set('fill-outline-color', 'rgba(0,0,0,0)')
        if (id.includes('water') || id.includes('ocean')) set('fill-color', MAP_BASE.water)
        else if (id.includes('building')) set('fill-color', MAP_BASE.landAlt)
        else set('fill-color', MAP_BASE.land)
        break
      case 'fill-extrusion':
        map.setLayoutProperty(layer.id, 'visibility', 'none')
        break
      case 'line':
        if (id.includes('boundary') || id.includes('admin')) {
          set('line-color', MAP_BASE.boundary)
        } else if (id.includes('water') || id.includes('river')) {
          set('line-color', MAP_BASE.water)
        } else {
          set('line-color', MAP_BASE.road)
        }
        break
      case 'symbol':
        if (
          id.includes('poi') ||
          id.includes('housenumber') ||
          id.includes('highway') ||
          id.includes('road')
        ) {
          map.setLayoutProperty(layer.id, 'visibility', 'none')
          break
        }
        set('text-color', MAP_BASE.label)
        set('text-halo-color', MAP_BASE.labelHalo)
        set('icon-opacity', 0)
        break
      case 'raster':
      case 'hillshade':
        set('raster-brightness-max', MAP_BASE.rasterBrightness)
        break
    }
  }
}
