// Legal and health guidance shown in the "Tes droits" window. Written from
// justice.fr, service-public.fr, the Défenseur des droits, the LDH and medical sources;
// general information, not legal advice.

export interface RightsSection {
  id: string
  title: string
  points: string[]
}

export interface RightsLink {
  label: string
  href: string
  /** Phone number next to the link, if there is one. */
  phone?: string
}

export const RIGHTS_INTRO =
  "Tu n'es pas seul·e, et tu as des droits. Voici l'essentiel à garder sous la main. Ce n'est pas un conseil juridique : en cas de doute, demande un avocat."

export const RIGHTS_SECTIONS: ReadonlyArray<RightsSection> = [
  {
    id: 'forces-de-l-ordre',
    title: 'Face aux CRS et à la police',
    points: [
      'Avant de disperser un rassemblement par la force, ils doivent faire deux sommations (« Obéissance à la loi, dispersez-vous », puis « dernière sommation »). Écoute-les : après, ils peuvent faire usage de la force, mieux vaut être parti·e.',
      "Chaque agent doit porter son numéro d'identification (le RIO), bien visible. Le Conseil d'État a rappelé qu'il doit rester lisible, y compris en manif. Si tu peux, note-le.",
      'Reste en groupe, ne te laisse pas isoler, et préviens un proche de là où tu es.',
      "Ne tombe pas dans la provocation : insultes, jets d'objets ou dégradations, c'est le meilleur moyen de finir en garde à vue.",
      "Blessé·e ou témoin de violences : fais-toi examiner par un médecin (le certificat constate tes blessures), garde les preuves (photos, vidéos, noms de témoins), note l'heure et le lieu. Tu peux saisir le Défenseur des droits.",
    ],
  },
  {
    id: 'gaz',
    title: 'Gaz lacrymogènes',
    points: [
      "Éloigne-toi de la zone, à l'air libre. Ne te frotte pas les yeux et garde la bouche fermée.",
      'Rince les yeux au sérum physiologique, sinon à l’eau. Rince la peau à l’eau froide, sans la toucher avec les doigts.',
      'Change de vêtements dès que possible et lave-toi les mains.',
      'Les gaz irritent surtout les yeux et les voies respiratoires. Évite les lentilles : elles retiennent le produit.',
      "Attention : dissimuler volontairement son visage dans ou aux abords d'une manifestation, sans motif légitime, est un délit (art. 431-9-1 du code pénal : 1 an de prison et 15 000 € d'amende) quand des troubles à l'ordre public sont commis ou risquent de l'être. Un motif de santé (asthme, fragilité respiratoire) peut être retenu comme légitime, mais c'est apprécié au cas par cas : renseigne-toi avant auprès de la LDH ou d'un avocat.",
      'Difficulté à respirer (asthme, malaise) : appelle les secours, 15, 18 ou 112.',
    ],
  },
  {
    id: 'garde-a-vue',
    title: 'Si tu es placé·e en garde à vue',
    points: [
      "Respire, tu as des droits dès la première minute. On doit t'informer tout de suite de tes droits et du motif.",
      'Tu peux faire prévenir un proche (tes parents), voir un médecin et parler à un avocat. Demande-le dès le début.',
      'Demande un médecin même si tu vas bien : son examen garde une trace écrite de ton état au début de la garde à vue. Ça compte si tu es blessé·e après, sans témoin.',
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
