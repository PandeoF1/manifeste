// Enregistrement de la consommation de tokens (table ai_usage, graphiques de l'admin).
import type { TokenUsage } from './gemini.ts'

export type AiTask = 'extraction' | 'media' | 'reanalyse' | 'backfill' | 'judge'

export interface AiUsageRow {
  task: AiTask
  model: string
  calls: number
  prompt_tokens: number
  output_tokens: number
  thoughts_tokens: number
}

/** Lignes à enregistrer pour une tâche : un modèle sans requête aboutie n'a rien consommé. */
export function usageRows(
  task: AiTask,
  byModel: Readonly<Record<string, TokenUsage>>,
): AiUsageRow[] {
  return Object.entries(byModel)
    .filter(([, u]) => u.calls > 0)
    .map(([model, u]) => ({
      task,
      model,
      calls: u.calls,
      prompt_tokens: u.promptTokens,
      output_tokens: u.outputTokens,
      thoughts_tokens: u.thoughtsTokens,
    }))
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>
}

/**
 * Ajoute la consommation à l'heure en cours. Ne fait jamais échouer l'appelant : un compteur
 * perdu vaut mieux qu'une collecte interrompue (et la migration peut ne pas être appliquée).
 */
export async function recordAiUsage(
  client: RpcClient,
  rows: ReadonlyArray<AiUsageRow>,
): Promise<void> {
  if (rows.length === 0) return
  try {
    const { error } = await client.rpc('record_ai_usage', { p_rows: rows })
    if (error) console.error('record_ai_usage', error.message)
  } catch (e) {
    console.error('record_ai_usage', e instanceof Error ? e.message : e)
  }
}
