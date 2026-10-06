// Repères juridiques et sanitaires affichés dans la fenêtre « Tes droits ». Rédigés d'après
// justice.fr, service-public.fr, le Défenseur des droits, la LDH et des sources médicales ;
// informations générales, pas un conseil juridique.

export interface RightsSection {
  id: string
  title: string
  points: string[]
}

export interface RightsLink {
  label: string
  href: string
  /** Numéro de téléphone à côté du lien, s'il y en a un. */
  phone?: string
}

export const RIGHTS_INTRO =
  'Des repères généraux, pas un conseil juridique : la loi change et chaque situation est différente. En cas de doute, demande un avocat.'

export const RIGHTS_SECTIONS: ReadonlyArray<RightsSection> = [
  {
    id: 'forces-de-l-ordre',
    title: "Face aux forces de l'ordre",
    points: [
      'Avant de disperser un rassemblement par la force, elles doivent faire deux sommations (« Obéissance à la loi, dispersez-vous », puis une dernière). Quand elles ont été faites, quitte les lieux calmement.',
      "Les agents doivent porter leur numéro d'identification (le RIO), de façon visible. Tu peux le noter.",
      'Reste avec d’autres personnes plutôt que seul·e, et garde ton calme : insultes, jets d’objets ou dégradations peuvent mener à des poursuites.',
      "Blessé·e ou témoin de violences : demande un médecin, garde les preuves (photos, vidéos, noms de témoins), note l'heure et le lieu. Tu peux saisir le Défenseur des droits.",
    ],
  },
  {
    id: 'gaz',
    title: 'Gaz lacrymogènes',
    points: [
      "Éloigne-toi de la zone, à l'air libre. Ne te frotte pas les yeux et garde la bouche fermée.",
      'Rince les yeux au sérum physiologique, sinon à l’eau. Rince la peau à l’eau froide, sans la toucher avec les doigts.',
      'Change de vêtements dès que possible et lave-toi les mains.',
      'Des lunettes bien couvrantes et un masque FFP2 limitent les effets. Évite les lentilles.',
      'Difficulté à respirer (asthme, malaise) : appelle les secours, 15, 18 ou 112.',
    ],
  },
  {
    id: 'garde-a-vue',
    title: 'Si tu es placé·e en garde à vue',
    points: [
      'On doit t’informer tout de suite de tes droits et du motif.',
      'Tu peux faire prévenir un proche (tes parents), voir un médecin et parler à un avocat. Demande-le dès le début.',
      'Ton identité, tu dois la donner. Pour le reste, tu peux garder le silence et attendre ton avocat.',
      "Relis le procès-verbal avant de le signer. S'il ne correspond pas à ce que tu as dit, demande qu'on le corrige.",
      'La garde à vue dure 24 h, prolongeable de 24 h pour un majeur.',
      "Si tu es mineur·e : tes parents doivent être prévenus, un avocat est obligatoire et, avant 16 ans, un médecin doit t'examiner. La durée est encadrée plus strictement.",
    ],
  },
]

export const RIGHTS_LINKS: ReadonlyArray<RightsLink> = [
  { label: 'Urgences : SAMU, pompiers, numéro européen', href: 'tel:112', phone: '15 · 18 · 112' },
  {
    label: 'Défenseur des droits (comportement des forces de l’ordre)',
    href: 'https://www.defenseurdesdroits.fr',
    phone: '09 69 39 00 00',
  },
  { label: 'La garde à vue (justice.fr)', href: 'https://www.justice.fr/fiche/garde-vue' },
  {
    label: 'Fiche « Garde à vue » de la Ligue des droits de l’Homme',
    href: 'https://www.ldh-france.org/wp-content/uploads/2024/04/Fiche-triptique-A4_Nosdroits_En-GAV_Avril-2024.pdf',
  },
]
