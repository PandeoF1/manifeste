/**
 * What a benchmark can compare, written as short specs on the command line:
 *
 *   judge:    jev-recorded            Jev's frozen answers from when the sample was built (offline)
 *             jev | jev@jev-1.13.0    Jev through the API
 *             llm:gemini:gemini-3.5-flash   a general model answering the same questions
 *   extract:  v1@gemini:gemini-3.5-flash-lite    prompt version @ provider:model
 *             v1-strict@anthropic:claude-haiku-5-5
 *
 * Every live variant runs a chain of exactly one model: a fallback would blur the comparison.
 */
import {
  aiConfigFromEnv,
  DEFAULT_AI_CONFIG,
  EXTRACT_PROMPT_VERSIONS,
  type AiConfig,
  type ExtractPromptVersion,
  type ModelRef,
} from '@manifeste/ai'

export type JudgeSpec =
  | { kind: 'recorded'; name: string }
  | { kind: 'jev'; name: string; model: string }
  | { kind: 'llm'; name: string; model: ModelRef }

export interface ExtractSpec {
  name: string
  prompt: ExtractPromptVersion
  model: ModelRef
}

const PROVIDERS = ['gemini', 'anthropic', 'openai-compatible'] as const

function modelRef(text: string, thinking?: number): ModelRef {
  const at = text.indexOf(':')
  const provider = text.slice(0, at)
  const model = text.slice(at + 1)
  if (!(PROVIDERS as readonly string[]).includes(provider) || !model)
    throw new Error(`bad model "${text}": expected <${PROVIDERS.join('|')}>:<model>`)
  return {
    provider: provider as ModelRef['provider'],
    model,
    ...(provider === 'gemini' && thinking !== undefined && { thinkingBudget: thinking }),
  }
}

export function parseJudgeSpec(spec: string, thinking?: number): JudgeSpec {
  if (spec === 'jev-recorded') return { kind: 'recorded', name: spec }
  if (spec === 'jev' || spec.startsWith('jev@'))
    return { kind: 'jev', name: spec, model: spec.split('@')[1] ?? 'jev-1.13.0' }
  if (spec.startsWith('llm:'))
    return { kind: 'llm', name: spec, model: modelRef(spec.slice(4), thinking) }
  throw new Error(`unknown judge variant "${spec}"`)
}

export function parseExtractSpec(spec: string, thinking?: number): ExtractSpec {
  const [prompt, model] = spec.split('@')
  if (!prompt || !model || !(EXTRACT_PROMPT_VERSIONS as string[]).includes(prompt))
    throw new Error(
      `unknown extract variant "${spec}": expected <${EXTRACT_PROMPT_VERSIONS.join('|')}>@<provider>:<model>`,
    )
  return { name: spec, prompt: prompt as ExtractPromptVersion, model: modelRef(model, thinking) }
}

/** Credentials: the real ones for a live run, placeholders for an offline replay. */
export function credentials(
  live: boolean,
  env: Record<string, string | undefined>,
): AiConfig['credentials'] {
  if (live) {
    const real = aiConfigFromEnv(env).credentials
    const base = env.OPENAI_BASE_URL
    return {
      ...real,
      openaiCompatible:
        base && env.OPENAI_API_KEY
          ? { default: { baseUrl: base, apiKey: env.OPENAI_API_KEY } }
          : {},
    }
  }
  return {
    gemini: { apiKey: 'offline' },
    anthropic: { apiKey: 'offline' },
    jev: { apiKey: 'offline' },
    openaiCompatible: { default: { baseUrl: 'https://offline.invalid/v1', apiKey: 'offline' } },
  }
}

export function judgeConfig(spec: JudgeSpec, creds: AiConfig['credentials']): AiConfig {
  const judge: AiConfig['tasks']['judge'] =
    spec.kind === 'jev'
      ? { kind: 'jev', model: spec.model }
      : spec.kind === 'llm'
        ? { kind: 'llm', models: [spec.model] }
        : { kind: 'off' }
  return {
    ...DEFAULT_AI_CONFIG,
    credentials: creds,
    tasks: { ...DEFAULT_AI_CONFIG.tasks, judge },
  }
}

export function extractConfig(spec: ExtractSpec, creds: AiConfig['credentials']): AiConfig {
  return {
    ...DEFAULT_AI_CONFIG,
    credentials: creds,
    tasks: {
      ...DEFAULT_AI_CONFIG.tasks,
      extract: {
        ...DEFAULT_AI_CONFIG.tasks.extract,
        models: [spec.model],
        prompt: spec.prompt,
        retriesPerModel: 2,
      },
    },
  }
}
