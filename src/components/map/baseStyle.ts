import type { Map as MapLibreMap } from 'maplibre-gl'
import type { MapBase } from './palette'

/**
 * Recolore n'importe quel style vectoriel (OpenFreeMap positron par défaut) à la volée, en
 * sombre ou en clair : on garde la géographie (côtes, frontières, villes) mais tout passe au
 * second plan, pour que seuls les signaux ressortent. Chaque propriété est posée explicitement :
 * on peut changer de thème à chaud, sans recharger le style.
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
        // propriété absente pour ce type de calque
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
