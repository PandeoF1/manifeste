import type { AiTask, CallRecord, UsageSink } from './types.ts'

export interface UsageRow {
  task: AiTask
  provider: string
  model: string
  promptVersion: string
  calls: number
  failures: number
  promptTokens: number
  outputTokens: number
  thoughtsTokens: number
  costUsd: number
  latencyMsTotal: number
}

/**
 * Sums calls in memory by (task, provider, model, prompt version) until `drain()` hands the rows
 * to whoever persists them. Recording never throws: a lost counter beats a broken run.
 */
export function createMeter(onCall?: (call: CallRecord) => void): UsageSink & {
  drain(): UsageRow[]
  readonly spentUsd: number
} {
  const rows = new Map<string, UsageRow>()
  let spent = 0
  return {
    record(call) {
      try {
        const key = [call.task, call.provider, call.model, call.promptVersion].join('|')
        const row = rows.get(key) ?? {
          task: call.task,
          provider: call.provider,
          model: call.model,
          promptVersion: call.promptVersion,
          calls: 0,
          failures: 0,
          promptTokens: 0,
          outputTokens: 0,
          thoughtsTokens: 0,
          costUsd: 0,
          latencyMsTotal: 0,
        }
        row.calls += 1
        if (call.outcome !== 'ok') row.failures += 1
        row.promptTokens += call.usage.promptTokens
        row.outputTokens += call.usage.outputTokens
        row.thoughtsTokens += call.usage.thoughtsTokens
        row.costUsd += call.costUsd
        row.latencyMsTotal += call.latencyMs
        rows.set(key, row)
        spent += call.costUsd
        onCall?.(call)
      } catch {
        // see above
      }
    },
    drain() {
      const out = [...rows.values()]
      rows.clear()
      return out
    },
    get spentUsd() {
      return spent
    },
  }
}
