/**
 * Generates every variant of the logo from brand/logo-mark.svg:
 * favicon, PWA icons (192, 512, maskable), apple-touch-icon, default share image,
 * and the logo embedded in dynamic Open Graph images (api/_brand.ts).
 *
 *   npm run brand
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const RED = '#ff453a'
const INK = '#07090d'
const source = readFileSync('brand/logo-mark.svg', 'utf8')
const mark = source.match(/<g id="mark">[\s\S]*<\/g>\s*<\/svg>/)?.[0].replace(/<\/svg>$/, '')
if (!mark) throw new Error('Groupe #mark introuvable dans brand/logo-mark.svg')

/** The symbol on a red background, with a margin (0 = full frame, 0.1 = 10% on each side). */
function tile(padding: number, radius = 0): string {
  const scale = 1 - padding * 2
  const offset = 512 * padding
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><clipPath id="c"><rect width="512" height="512" rx="${radius}"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="512" height="512" fill="${RED}"/>
    <g transform="translate(${offset} ${offset}) scale(${scale})">${mark}</g>
  </g>
</svg>`
}

function png(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } })
    .render()
    .asPng()
}

const wordmark = (x: number, y: number, size: number) =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="900" font-size="${size}" fill="#ffffff" letter-spacing="2">MANIFESTE</text>`

mkdirSync('public/icons', { recursive: true })

// Favicon: rounded corners, symbol filling the frame.
writeFileSync('public/favicon.svg', tile(0, 96))
writeFileSync('public/icons/icon-192.png', png(tile(0, 0), 192))
writeFileSync('public/icons/icon-512.png', png(tile(0, 0), 512))
// Maskable: the symbol fits in the safe zone (80% circle).
writeFileSync('public/icons/maskable-512.png', png(tile(0.12, 0), 512))
writeFileSync('public/icons/apple-touch-icon.png', png(tile(0.06, 0), 180))

// Horizontal logo (symbol + name), for the README and social networks.
const horizontal = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 512">
  <rect width="1400" height="512" fill="${INK}"/>
  <g transform="translate(64 64) scale(0.75)">${tile(0, 72).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>
  ${wordmark(510, 300, 128)}
</svg>`
writeFileSync('brand/logo-horizontal.svg', horizontal)
writeFileSync('brand/logo-horizontal.png', png(horizontal, 1400))

// Default share image (1200 x 630), used if the dynamic image is unavailable.
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${INK}"/>
  <g transform="translate(80 135) scale(0.7)">${tile(0, 64).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>
  ${wordmark(500, 300, 96)}
  <text x="502" y="370" font-family="DejaVu Sans, Arial, sans-serif" font-size="38" fill="#eef0f4">Les lycées mobilisés, en direct.</text>
  <text x="502" y="425" font-family="DejaVu Sans, Arial, sans-serif" font-size="25" fill="#9aa3b2">Partout en France, les lycéens se font entendre.</text>
</svg>`
writeFileSync('public/og-default.png', png(og, 1200))

// Symbol for the dynamic Open Graph images (satori accepts SVG data URIs).
writeFileSync(
  'api/_brand.ts',
  `// Généré par scripts/generate-brand.ts - ne pas modifier à la main.\nexport const MARK_DATA_URI =\n  'data:image/svg+xml;base64,${Buffer.from(tile(0, 64)).toString('base64')}'\n`,
)

console.log('Logo et icônes générés.')
