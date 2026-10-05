/**
 * Établissements à exclure du référentiel :
 * - les « Sections d'enseignement professionnel / général et technologique » : sous-unités
 *   administratives d'un lycée, au même endroit, avec leur propre UAI. Les garder crée des
 *   doublons sur la carte et empêche de rattacher « Lycée Queneau » (homonyme quasi parfait) ;
 * - les « écoles secondaires » privées hors contrat, qui ne sont pas des lycées.
 */
export function isExcludedEstablishment(name: string): boolean {
  const n = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return /^(section d enseignement|sep |segt |ecole secondaire)/.test(n)
}
