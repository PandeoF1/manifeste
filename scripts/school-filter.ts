/**
 * Établissements à exclure du référentiel :
 * - les « Sections d'enseignement professionnel / général et technologique » : sous-unités
 *   administratives d'un lycée, au même endroit, avec leur propre UAI. Les garder crée des
 *   doublons sur la carte et empêche de rattacher « Lycée Queneau » (homonyme quasi parfait) ;
 * - les « écoles secondaires » privées hors contrat, qui ne sont pas des lycées.
 */
/**
 * Sur le nom normalisé. Les données officielles varient : « Section d'enseignement »,
 * « Sectiond'enseignement », « Section Enseignement », « SEP », « S.E.P. », « SEGT »…
 * Même règle en SQL : migrations 20261006000015 et 20261006000026.
 */
export const EXCLUDED = /^(section ?d? ?enseignement|s ?e ?p |s ?e ?g ?t |ecole secondaire)/

export function isExcludedEstablishment(name: string): boolean {
  const n = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return EXCLUDED.test(n)
}
