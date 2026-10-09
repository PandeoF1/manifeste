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
