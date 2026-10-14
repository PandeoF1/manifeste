// Repérage d'un établissement dans un texte (partagé par la collecte et les scripts d'audit).

const GENERIC = new Set(
  'lycee polyvalent professionnel professionnelle technologique general generale metiers prive public universite institut ecole saint sainte'.split(
    ' ',
  ),
)

export { GENERIC }

export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Phrases du texte qui parlent de l'établissement (nom distinctif ou commune). */
export function sentencesAbout(text: string, school: { name: string; city: string }): string[] {
  const keys = [
    ...(norm(school.name).match(/[a-z]{5,}/g) ?? []).filter((w) => !GENERIC.has(w)),
    ...(norm(school.city).match(/[a-z]{4,}/g) ?? []),
  ]
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter((st) => keys.some((k) => norm(st).includes(k)))
    .slice(0, 4)
}

const STOP = new Set<string>('de du des la le les et en d l'.split(' '))

/**
 * Un événement extrait parle-t-il de cet établissement ?
 *  - « oui » : un mot distinctif du nom (ou son sigle : « ENS » pour École normale supérieure) ;
 *  - « ville » : même commune mais le nom n'est pas reconnu (plusieurs établissements possibles) ;
 *  - « non » : rien en commun.
 * Une université dont le seul mot distinctif est la commune (« Université de Nantes ») est reconnue par la commune.
 */
export function matchSchool(
  ev: { school_name: string; city: string | null },
  school: { name: string; city: string },
): 'oui' | 'ville' | 'non' {
  const name = norm(ev.school_name)
  const cityWords: string[] = norm(school.city).match(/[a-z]{4,}/g) ?? []
  const keys = (norm(school.name).match(/[a-z]{5,}/g) ?? []).filter((w) => !GENERIC.has(w))
  const sameCity = norm(ev.city) === norm(school.city) || cityWords.some((w) => name.includes(w))
  if (keys.some((k) => name.includes(k))) return 'oui'
  const initials = (norm(school.name).match(/[a-z]+/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => w[0])
    .join('')
  if (initials.length >= 3 && new RegExp(`\\b${initials}\\b`).test(name)) return 'oui'
  if (!keys.length || keys.every((k) => cityWords.includes(k))) return sameCity ? 'oui' : 'non'
  return sameCity ? 'ville' : 'non'
}

export function sameSchool(
  ev: { school_name: string; city: string | null },
  school: { name: string; city: string },
): boolean {
  return matchSchool(ev, school) === 'oui'
}
