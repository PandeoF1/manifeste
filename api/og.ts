// Image d'aperçu (1200 x 630) pour Discord, Telegram, WhatsApp, X... :
//   /api/og            -> chiffres nationaux en direct
//   /api/og?uai=XXXX   -> situation d'un lycée
import { ImageResponse } from '@vercel/og'
import type { ReactElement } from 'react'
import { MARK_DATA_URI } from './_brand'
import {
  nationalSummary,
  parisTime,
  plural,
  schoolSummary,
  STATUS_COLOR,
  STATUS_LABEL,
  type NationalSummary,
  type SchoolSummary,
} from './_data'

export const config = { runtime: 'edge' }

type Child = Node | string | number | null | false
interface Node {
  type: string
  props: Record<string, unknown> & { children?: Child | Child[] }
}
/** Mini-JSX pour satori (évite une étape de compilation JSX dans les fonctions). */
function h(type: string, style: Record<string, unknown>, ...children: Child[]): Node {
  // satori exige display:flex sur tout bloc à plusieurs enfants : c'est le défaut ici.
  return {
    type,
    props: {
      style: { display: 'flex', ...style },
      children: children.filter((c) => c !== null && c !== false),
    },
  }
}
function img(src: string, size: number): Node {
  return {
    type: 'img',
    props: { src, width: size, height: size, style: { borderRadius: size * 0.14 } },
  }
}

const INK = '#07090d'
const MUTED = '#9aa3b2'

function frame(content: Node, footer: string): Node {
  return h(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
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
      { display: 'flex', alignItems: 'center', gap: 20 },
      img(MARK_DATA_URI, 72),
      h('div', { fontSize: 40, fontWeight: 900, letterSpacing: 2 }, 'MANIFESTE'),
      h(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginLeft: 'auto',
          fontSize: 26,
          color: '#ff453a',
        },
        h('div', { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ff453a' }),
        'EN DIRECT',
      ),
    ),
    content,
    h('div', { fontSize: 26, color: MUTED }, footer),
  )
}

function national(s: NationalSummary): Node {
  return h(
    'div',
    { display: 'flex', flexDirection: 'column' },
    h(
      'div',
      { display: 'flex', alignItems: 'flex-end', gap: 28 },
      h(
        'div',
        { fontSize: 200, fontWeight: 900, lineHeight: 1, color: '#ff453a' },
        String(s.bloque),
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
        h('div', {}, s.bloque > 1 ? 'lycées' : 'lycée'),
        h('div', {}, s.bloque > 1 ? 'bloqués' : 'bloqué'),
      ),
    ),
    h(
      'div',
      { display: 'flex', fontSize: 36, marginTop: 18, color: '#eef0f4' },
      `${s.filtrant} en barrage filtrant · dans ${plural(s.departments, 'département', 'départements')}`,
    ),
  )
}

function school(s: SchoolSummary): Node {
  const color = s.status ? STATUS_COLOR[s.status] : MUTED
  return h(
    'div',
    { display: 'flex', flexDirection: 'column' },
    h('div', { fontSize: 72, fontWeight: 900, lineHeight: 1.05, maxWidth: 1000 }, s.name),
    h(
      'div',
      { fontSize: 38, color: MUTED, marginTop: 10 },
      `${s.city}${s.department ? ` (${s.department})` : ''}`,
    ),
    h(
      'div',
      { display: 'flex', alignItems: 'center', gap: 18, marginTop: 34 },
      h(
        'div',
        {
          padding: '10px 26px',
          borderRadius: 999,
          backgroundColor: color,
          color: INK,
          fontSize: 44,
          fontWeight: 900,
        },
        s.status ? STATUS_LABEL[s.status] : 'Aucun signal en cours',
      ),
      s.last_signal_at
        ? h(
            'div',
            { fontSize: 34, color: '#eef0f4' },
            `dernier signal à ${parisTime(s.last_signal_at)}`,
          )
        : null,
    ),
  )
}

// Polices embarquées (Inter, licence OFL) : aucune requête vers un service de polices.
const fonts = Promise.all(
  ([400, 800, 900] as const).map(async (weight) => ({
    name: 'Inter',
    weight,
    style: 'normal' as const,
    data: await fetch(new URL(`./fonts/inter-${weight}.woff`, import.meta.url)).then((r) =>
      r.arrayBuffer(),
    ),
  })),
)

export default async function handler(req: Request): Promise<Response> {
  const uai = new URL(req.url).searchParams.get('uai')
  let body: Node
  try {
    if (uai) {
      const s = await schoolSummary(uai)
      body = s
        ? frame(school(s), 'Aucun lycée mobilisé n’est seul.')
        : frame(h('div', { fontSize: 64, fontWeight: 900 }, 'Lycée introuvable'), 'manifest')
    } else {
      body = frame(
        national(await nationalSummary()),
        'Partout en France, les lycéens se font entendre.',
      )
    }
  } catch {
    // Données indisponibles : image générique plutôt qu'une erreur.
    body = frame(
      h(
        'div',
        { fontSize: 72, fontWeight: 900, lineHeight: 1.1, maxWidth: 1000 },
        'Les lycées mobilisés, en direct.',
      ),
      'Partout en France, les lycéens se font entendre.',
    )
  }
  return new ImageResponse(body as unknown as ReactElement, {
    width: 1200,
    height: 630,
    fonts: await fonts,
    headers: {
      // Rafraîchi toutes les 5 min côté CDN ; les messageries gardent leur propre cache.
      'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
