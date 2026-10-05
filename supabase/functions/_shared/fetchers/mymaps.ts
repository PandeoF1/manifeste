// Carte Google My Maps publique : export KML (nom, description et coordonnées de chaque point).
// Chaque point devient un élément à analyser ; ses coordonnées servent ensuite à retrouver le
// lycée exact dans le référentiel.
import { XMLParser } from 'fast-xml-parser'
import { stripHtml } from './rss.ts'
import { fetchText, type FetchLike, type ScrapedItem } from './types.ts'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  cdataPropName: false,
})

type Node = Record<string, unknown>

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function text(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object' && '#text' in (v as Node)) return String((v as Node)['#text'] ?? '')
  return ''
}

export function myMapsUrl(mid: string): string {
  return `https://www.google.com/maps/d/viewer?mid=${encodeURIComponent(mid)}`
}

export function myMapsKmlUrl(mid: string): string {
  return `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`
}

/** Points de la carte (dossiers imbriqués compris). `now` : date de lecture (le KML n'en a pas). */
export function parseMyMapsKml(xml: string, mid: string, now: Date): ScrapedItem[] {
  const doc = parser.parse(xml) as Node
  const root = ((doc.kml as Node | undefined)?.Document as Node | undefined) ?? {}
  const mapTitle = text(root.name).trim()
  const items: ScrapedItem[] = []

  const visit = (node: Node, folder: string) => {
    for (const p of asArray(node.Placemark as Node | Node[] | undefined)) {
      // Points placés par coordonnées, ou seulement par adresse (cartes importées d'un tableur).
      const coords = text((p.Point as Node | undefined)?.coordinates).trim()
      const [lng, lat] = coords ? coords.split(',').map(Number) : []
      const geo =
        lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
          ? { lat, lng }
          : undefined
      const name = stripHtml(text(p.name))
      const address = stripHtml(text(p.address))
      const description = stripHtml(text(p.description)).slice(0, 1500)
      if (!name && !description) continue
      if (!geo && !address && !description) continue // ni position ni adresse : inexploitable
      const where = geo ? `${geo.lat.toFixed(4)},${geo.lng.toFixed(4)}` : address
      items.push({
        externalId: `${mid}:${name}:${where}`.slice(0, 500),
        url: myMapsUrl(mid),
        text: [
          `Carte « ${mapTitle} »${folder ? ` / ${folder}` : ''}`,
          name,
          address && address !== name ? `Adresse : ${address}` : '',
          description,
        ]
          .filter(Boolean)
          .join('\n'),
        publishedAt: now,
        ...(geo ? { geo } : {}),
        alwaysRelevant: true,
      })
    }
    for (const f of asArray(node.Folder as Node | Node[] | undefined)) visit(f, text(f.name).trim())
  }
  visit(root, '')
  return items
}

export async function fetchMyMaps(fetchFn: FetchLike, mid: string): Promise<ScrapedItem[]> {
  return parseMyMapsKml(await fetchText(fetchFn, myMapsKmlUrl(mid)), mid, new Date())
}
