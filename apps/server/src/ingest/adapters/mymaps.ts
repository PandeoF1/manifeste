/**
 * A public Google My Maps map, read as KML: name, description and coordinates of each point.
 * Every point becomes an item, and its position later finds the exact school.
 */
import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { fetchText } from '../http.ts'
import { IdentifierError, type ScrapedItem, type SourceAdapter } from '../types.ts'
import { asArray, stripHtml, text } from './rss.ts'

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  htmlEntities: true,
  cdataPropName: false,
})

type Node = Record<string, unknown>

export const myMapsUrl = (mid: string) =>
  `https://www.google.com/maps/d/viewer?mid=${encodeURIComponent(mid)}`
export const myMapsKmlUrl = (mid: string) =>
  `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`

/** Points of the map, nested folders included. `now`: reading time (KML has no dates). */
export function parseMyMapsKml(source: string, mid: string, now: Date): ScrapedItem[] {
  const doc = xml.parse(source) as Node
  const root = ((doc.kml as Node | undefined)?.Document as Node | undefined) ?? {}
  const mapTitle = text(root.name).trim()
  const items: ScrapedItem[] = []

  const visit = (node: Node, folder: string) => {
    for (const p of asArray(node.Placemark as Node | Node[] | undefined)) {
      // Placed by coordinates, or by address only (maps imported from a spreadsheet).
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
      if (!geo && !address && !description) continue // no position, no address: unusable
      const where = geo ? `${geo.lat.toFixed(4)},${geo.lng.toFixed(4)}` : address
      const body = [
        // The French header is what the extraction prompt recognises as a map point.
        `Carte « ${mapTitle} »${folder ? ` / ${folder}` : ''}`,
        name,
        address && address !== name ? `Adresse : ${address}` : '',
        description,
      ]
        .filter(Boolean)
        .join('\n')
      // A point is edited in place on the map ("bloqué" becomes "levé", a line is added). The
      // identifier follows the content, so an edit is a new item that gets analysed, instead of
      // being swallowed as "already seen". The same report is still never created twice
      // (one report per school, link and status).
      const version = createHash('sha1').update(body).digest('hex').slice(0, 10)
      items.push({
        externalId: `${mid}:${name}:${where}:${version}`.slice(0, 500),
        url: myMapsUrl(mid),
        text: body,
        publishedAt: now,
        ...(geo && { geo }),
        alwaysRelevant: true,
      })
    }
    for (const f of asArray(node.Folder as Node | Node[] | undefined)) visit(f, text(f.name).trim())
  }
  visit(root, '')
  return items
}

export const myMapsAdapter: SourceAdapter = {
  kind: 'mymaps',
  label: 'Google My Maps map',
  normalize(input) {
    // The map link (viewer, edit, embed, kml) or its id.
    const raw = input.trim()
    const mid = raw.match(/[?&]mid=([A-Za-z0-9_-]+)/)?.[1] ?? raw
    if (!/^[A-Za-z0-9_-]{10,}$/.test(mid))
      throw new IdentifierError('Invalid My Maps link (it must contain "mid=").')
    return mid
  },
  async discover(fetchFn, identifier, now) {
    return parseMyMapsKml(await fetchText(fetchFn, myMapsKmlUrl(identifier)), identifier, now)
  },
}
