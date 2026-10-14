/**
 * How sure the extraction is: high = stated clearly and in the present; medium = probable;
 * low = a call to block, a rumour, a conditional, the future or an old fact.
 */
export const CERTAINTIES = ['high', 'medium', 'low'] as const
export type Certainty = (typeof CERTAINTIES)[number]

const RANK: Record<Certainty, number> = { low: 0, medium: 1, high: 2 }

export const meetsCertainty = (value: Certainty, min: Certainty): boolean =>
  RANK[value] >= RANK[min]
