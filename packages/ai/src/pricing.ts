import type { TokenUsage } from './types.ts'

/** USD per million tokens. Thinking tokens are billed at the output price. */
export interface Price {
  inputPerMTok: number
  outputPerMTok: number
}
export type PriceTable = Readonly<Record<string, Price>>

/**
 * Public list prices at the time of writing; the config can override any of them. They only feed
 * the cost estimate and the daily budget, never a bill.
 */
export const DEFAULT_PRICES: PriceTable = {
  'gemini-3.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gemini-3.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-3.6-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-3.8-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'claude-haiku-5-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-sonnet-5-5': { inputPerMTok: 3, outputPerMTok: 15 },
  // Jev bills 42 USD per billion input tokens and nothing for the output.
  'jev-1.13.0': { inputPerMTok: 0.042, outputPerMTok: 0 },
}

export function costOf(prices: PriceTable, model: string, usage: TokenUsage): number {
  const price = prices[model]
  if (!price) return 0
  return (
    (usage.promptTokens * price.inputPerMTok +
      (usage.outputTokens + usage.thoughtsTokens) * price.outputPerMTok) /
    1_000_000
  )
}
