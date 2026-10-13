/**
 * The 1200 x 630 preview image (Discord, Telegram, WhatsApp, X…): national figures, or the
 * situation of one school. Drawn with satori (layout to SVG) and rasterised by resvg (WASM, so
 * the server stays one bundle with no native module). Inter fonts are served by the site itself.
 */
import { join } from 'node:path'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import satori from 'satori'
import { MARK_DATA_URI } from './brand.ts'
import {
  parisTime,
  STATUS_COLOR,
  STATUS_LABEL,
  type NationalSummary,
  type SchoolSummary,
} from './html.ts'

type Child = Node | string | number | null | false
interface Node {
  type: string
  props: Record<string, unknown> & { children?: Child | Child[] }
}

/** Mini-JSX for satori: every block is a flex container (satori requires it). */
function h(type: string, style: Record<string, unknown>, ...children: Child[]): Node {
  return {
    type,
    props: {
      style: { display: 'flex', ...style },
      children: children.filter((c) => c !== null && c !== false),
    },
  }
}

const img = (src: string, size: number): Node => ({
  type: 'img',
  props: { src, width: size, height: size, style: { borderRadius: size * 0.14 } },
})

const INK = '#07090d'
const MUTED = '#9aa3b2'
const TAGLINE = 'Partout en France, les lycéens et les étudiants se font entendre.'

function frame(content: Node, footer: string): Node {
  return h(
    'div',
    {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      justifyContent: 'space-between',
      backgroundColor: INK,
      backgroundImage:
        'radial-gradient(circle at 78% 45%, rgba(255,69,58,0.35), rgba(7,9,13,0) 55%)',
      color: '#ffffff',
      padding: '56px 64px',
      fontFamily: 'Inter',
    },
    h(
      'div',
      { alignItems: 'center', gap: 20 },
      img(MARK_DATA_URI, 72),
      h('div', { fontSize: 40, fontWeight: 900, letterSpacing: 2 }, 'MANIFESTE'),
    ),
    content,
    h('div', { fontSize: 26, color: MUTED }, footer),
  )
}

const national = (s: NationalSummary): Node =>
  h(
    'div',
    { flexDirection: 'column' },
    h(
      'div',
      { alignItems: 'flex-end', gap: 28 },
      h(
        'div',
        { fontSize: 200, fontWeight: 900, lineHeight: 1, color: '#ff453a' },
        String(s.total),
      ),
      h(
        'div',
        {
          flexDirection: 'column',
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.05,
          paddingBottom: 18,
        },
        h('div', {}, s.total > 1 ? 'établissements' : 'établissement'),
        h('div', {}, s.total > 1 ? 'mobilisés' : 'mobilisé'),
      ),
    ),
    h(
      'div',
      { fontSize: 36, marginTop: 18, color: '#eef0f4' },
      `depuis le début · dont ${s.blocked} bloqué${s.blocked > 1 ? 's' : ''} en ce moment`,
    ),
  )

const school = (s: SchoolSummary): Node =>
  h(
    'div',
    { flexDirection: 'column' },
    h('div', { fontSize: 72, fontWeight: 900, lineHeight: 1.05, maxWidth: 1000 }, s.name),
    h(
      'div',
      { fontSize: 38, color: MUTED, marginTop: 10 },
      `${s.city}${s.department ? ` (${s.department})` : ''}`,
    ),
    h(
      'div',
      { alignItems: 'center', gap: 18, marginTop: 34 },
      h(
        'div',
        {
          padding: '10px 26px',
          borderRadius: 999,
          backgroundColor: s.status ? STATUS_COLOR[s.status] : MUTED,
          color: INK,
          fontSize: 44,
          fontWeight: 900,
        },
        s.status ? STATUS_LABEL[s.status] : 'Aucun signal en cours',
      ),
      s.lastSignalAt
        ? h(
            'div',
            { fontSize: 34, color: '#eef0f4' },
            `dernier signal à ${parisTime(s.lastSignalAt)}`,
          )
        : null,
    ),
  )

export type OgContent =
  | { kind: 'national'; summary: NationalSummary }
  | { kind: 'school'; summary: SchoolSummary }
  | { kind: 'not-found' }
  | { kind: 'generic' }

function layout(content: OgContent): Node {
  switch (content.kind) {
    case 'national':
      return frame(national(content.summary), TAGLINE)
    case 'school':
      return frame(school(content.summary), 'Aucun établissement mobilisé n’est seul.')
    case 'not-found':
      return frame(
        h('div', { fontSize: 64, fontWeight: 900 }, 'Établissement introuvable'),
        'manifeste',
      )
    case 'generic':
      // Data unavailable: a generic image rather than an error.
      return frame(
        h(
          'div',
          { fontSize: 72, fontWeight: 900, lineHeight: 1.1, maxWidth: 1000 },
          'Les lycées et les facs mobilisés, en direct.',
        ),
        TAGLINE,
      )
  }
}

type Font = { name: string; weight: 400 | 800 | 900; style: 'normal'; data: ArrayBuffer }

export interface OgAssets {
  /** Folder holding inter-{400,800,900}.woff (the built site's /fonts). */
  fontsDir: string
  /** The resvg WASM file; defaults to the one in node_modules. */
  wasmPath?: string
}

let ready: Promise<void> | null = null
const fonts = new Map<string, Promise<Font[]>>()

function loadWasm(path: string | undefined): Promise<void> {
  ready ??= (async () => {
    const file = path ?? Bun.resolveSync('@resvg/resvg-wasm/index_bg.wasm', import.meta.dir)
    await initWasm(await Bun.file(file).arrayBuffer())
  })().catch((error) => {
    ready = null // try again on the next request
    throw error
  })
  return ready
}

function loadFonts(dir: string): Promise<Font[]> {
  let loaded = fonts.get(dir)
  if (!loaded) {
    loaded = Promise.all(
      ([400, 800, 900] as const).map(async (weight) => ({
        name: 'Inter',
        weight,
        style: 'normal' as const,
        data: await Bun.file(join(dir, `inter-${weight}.woff`)).arrayBuffer(),
      })),
    ).catch((error) => {
      fonts.delete(dir)
      throw error
    })
    fonts.set(dir, loaded)
  }
  return loaded
}

/** Renders the preview as a PNG. */
export async function renderOg(content: OgContent, assets: OgAssets): Promise<Uint8Array> {
  const [, loadedFonts] = await Promise.all([loadWasm(assets.wasmPath), loadFonts(assets.fontsDir)])
  const svg = await satori(layout(content) as never, {
    width: 1200,
    height: 630,
    fonts: loadedFonts,
  })
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
}
