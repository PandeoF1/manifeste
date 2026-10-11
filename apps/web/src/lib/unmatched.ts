/** Starting search: the name without the word "lycée", plus the city. */
export function initialQuery(u: { schoolName: string; city: string | null }): string {
  const name = u.schoolName
    .replace(
      /^\s*(lyc[ée]e|lp|lgt|lpo)(\s+(professionnel|polyvalent|général|technologique))?\b/i,
      '',
    )
    .replace(/[«»"]/g, '')
    .trim()
  return [name, u.city ?? ''].filter(Boolean).join(' ').trim()
}
