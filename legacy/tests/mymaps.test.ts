import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMyMapsKml } from '@shared/fetchers/mymaps.ts'
import { pickByGeo } from '@shared/matching.ts'
import { normalizeSourceIdentifier } from '@shared/sources.ts'
import { extractArticleText } from '@shared/page.ts'

const kml = readFileSync(new URL('./fixtures/mymaps.kml', import.meta.url), 'utf8')
const now = new Date('2026-10-06T08:00:00Z')

describe('cartes Google My Maps', () => {
  it('lit les points (dossiers compris) avec position et contexte', () => {
    const items = parseMyMapsKml(kml, 'MID123456789', now)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      geo: { lat: 50.6371, lng: 3.0612 },
      alwaysRelevant: true,
      url: 'https://www.google.com/maps/d/viewer?mid=MID123456789',
      externalId: 'MID123456789:Lycée Pasteur:50.6371,3.0612',
    })
    expect(items[0]?.text).toBe(
      'Carte « Plus de 35 lycées fermés dans le Nord et le Pas-de-Calais » / Lycées fermés le 2 octobre\nLycée Pasteur\nLille\nFermé toute la journée',
    )
    expect(items[1]?.geo).toEqual({ lat: 50.2912, lng: 2.7801 })
  })

  it('accepte les points placés par adresse (sans coordonnées)', () => {
    const byAddress = parseMyMapsKml(kml, 'MID123456789', now)[2]
    expect(byAddress?.geo).toBeUndefined()
    expect(byAddress?.externalId).toBe(
      'MID123456789:Lycée Elisa LEMONNIER:Lycée Elisa LEMONNIER Douai Nord',
    )
    expect(byAddress?.text).toBe(
      'Carte « Plus de 35 lycées fermés dans le Nord et le Pas-de-Calais » / NPDC Lycées fermés - Feuille 1.csv\nLycée Elisa LEMONNIER\nAdresse : Lycée Elisa LEMONNIER Douai Nord\nVille: Douai\nDépartement: Nord',
    )
  })

  it("accepte le lien de la carte ou l'identifiant", () => {
    const mid = '143-XBuWkGffO5370dYlTSdy9Wvzk0ME'
    for (const input of [
      `https://www.google.com/maps/d/viewer?mid=${mid}&hl=en&ll=46.5,8.1&z=6`,
      `https://www.google.com/maps/d/u/0/embed?mid=${mid}`,
      mid,
    ]) {
      expect(normalizeSourceIdentifier('mymaps', input)).toBe(mid)
    }
    expect(() => normalizeSourceIdentifier('mymaps', 'https://www.google.com/maps')).toThrow()
  })
})

describe('rattachement par position', () => {
  const near = [
    { uai: 'A', name: 'Lycée Pasteur', distance_m: 120 },
    { uai: 'B', name: 'Lycée professionnel Pasteur', distance_m: 900 },
    { uai: 'C', name: 'Lycée Faidherbe', distance_m: 600 },
  ]
  it('préfère le nom concordant, puis le plus proche', () => {
    expect(pickByGeo(near, 'Lycée Faidherbe')?.uai).toBe('C')
    expect(pickByGeo(near, 'lycée Pasteur')?.uai).toBe('A')
  })
  it('sans nom concordant : le seul lycée à moins de 250 m, sinon rien', () => {
    expect(pickByGeo(near, 'Lycée')?.uai).toBe('A')
    expect(pickByGeo([...near, { uai: 'D', name: 'Lycée X', distance_m: 200 }], 'Lycée')).toBeNull()
    expect(pickByGeo([], 'Lycée Pasteur')).toBeNull()
  })
})

describe("corps d'article", () => {
  it('lit paragraphes et listes, ignore scripts et menus', () => {
    const html = `<html><body><nav><p>Menu</p></nav><article>
      <h2>Les lycées fermés</h2>
      <p>Après quatre jours de mobilisation, de nombreux établissements ont affiché porte close.</p>
      <ul><li>Lycée Pasteur (Lille)</li><li>Lycée Gambetta (Arras)</li></ul>
      <script>var x = "<p>pub</p>"</script>
    </article><footer><p>Mentions</p></footer></body></html>`
    expect(extractArticleText(html)).toBe(
      'Les lycées fermés\nAprès quatre jours de mobilisation, de nombreux établissements ont affiché porte close.\n- Lycée Pasteur (Lille)\n- Lycée Gambetta (Arras)',
    )
  })
})
