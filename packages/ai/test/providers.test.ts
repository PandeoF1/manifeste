import { describe, expect, test } from 'bun:test'
import { Type } from '@sinclair/typebox'
import {
  anthropicModel,
  geminiModel,
  openAiCompatibleModel,
  httpStoreFromJson,
  httpStoreToJson,
  recording,
  recordingFetch,
  replayFetch,
  replayModel,
  requestKey,
  storeFromJson,
  storeToJson,
  toGeminiSchema,
  AiError,
} from '../src/index.ts'
import { at, fakeFetch, json, request, scripted } from './helpers.ts'

describe('gemini adapter', () => {
  const ok = () =>
    json({
      candidates: [{ content: { parts: [{ text: '{"answer":"hi","score":null}' }] } }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 8, thoughtsTokenCount: 3 },
    })

  test('sends the system prompt, key header and translated schema; reads text and usage', async () => {
    const { fetch, seen } = fakeFetch(ok())
    const model = geminiModel({ apiKey: 'k', model: 'gemini-x', fetch, thinkingBudget: 0 })
    const result = await model.generate(request)
    expect(result.json).toEqual({ answer: 'hi', score: null })
    expect(result.usage).toEqual({
      calls: 1,
      promptTokens: 120,
      outputTokens: 8,
      thoughtsTokens: 3,
    })
    const sent = at(seen, 0)
    expect(sent.url).toContain('/models/gemini-x:generateContent')
    expect(sent.headers['x-goog-api-key']).toBe('k')
    const config = sent.body.generationConfig as Record<string, unknown>
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(config.responseMimeType).toBe('application/json')
    const schema = config.responseSchema as { type: string; properties: Record<string, unknown> }
    expect(schema.type).toBe('OBJECT')
    expect(schema.properties.score).toEqual({ type: 'NUMBER', nullable: true })
  })

  test('drops the thinking budget once after a 400 and remembers it', async () => {
    const { fetch, seen } = fakeFetch(
      json({ error: { message: 'thinking not supported' } }, 400),
      ok(),
      ok(),
    )
    const model = geminiModel({ apiKey: 'k', model: 'gemini-x', fetch, thinkingBudget: 0 })
    await model.generate(request)
    await model.generate(request)
    const hasThinking = seen.map((s) => 'thinkingConfig' in (s.body.generationConfig as object))
    expect(hasThinking).toEqual([true, false, false])
  })

  test('classifies errors', async () => {
    const cases: Array<[number, string]> = [
      [429, 'rate-limit'],
      [503, 'unavailable'],
      [404, 'not-found'],
      [402, 'billing'],
      [403, 'auth'],
    ]
    for (const [status, kind] of cases) {
      const { fetch } = fakeFetch(json({ error: { message: 'nope' } }, status))
      const model = geminiModel({ apiKey: 'k', model: 'm', fetch })
      const error = await model.generate(request).catch((e) => e)
      expect(error).toBeInstanceOf(AiError)
      expect(error.kind).toBe(kind)
    }
  })

  test('a network failure is an error of kind network, a timeout is unavailable', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    const net = geminiModel({ apiKey: 'k', model: 'm', fetch: fakeFetch(new Error('reset')).fetch })
    expect((await net.generate(request).catch((e) => e)).kind).toBe('network')
    const slow = geminiModel({ apiKey: 'k', model: 'm', fetch: fakeFetch(timeout).fetch })
    expect((await slow.generate(request).catch((e) => e)).kind).toBe('unavailable')
  })

  test('text that is not JSON comes back as null for the chain to judge', async () => {
    const { fetch } = fakeFetch(json({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }))
    expect(
      (await geminiModel({ apiKey: 'k', model: 'm', fetch }).generate(request)).json,
    ).toBeNull()
  })
})

describe('openai-compatible adapter', () => {
  test('structured output request and reasoning tokens split from output', async () => {
    const { fetch, seen } = fakeFetch(
      json({
        choices: [{ message: { content: '{"answer":"x","score":1}' } }],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
          completion_tokens_details: { reasoning_tokens: 20 },
        },
      }),
    )
    const model = openAiCompatibleModel({
      apiKey: 'sk',
      model: 'gpt',
      baseUrl: 'https://llm.example/v1/',
      fetch,
    })
    const result = await model.generate(request)
    expect(result.json).toEqual({ answer: 'x', score: 1 })
    expect(result.usage).toMatchObject({ promptTokens: 50, outputTokens: 10, thoughtsTokens: 20 })
    const sent = at(seen, 0)
    expect(sent.url).toBe('https://llm.example/v1/chat/completions')
    expect(sent.headers.authorization).toBe('Bearer sk')
    const format = sent.body.response_format as { type: string; json_schema: { strict: boolean } }
    expect(format.type).toBe('json_schema')
    expect(format.json_schema.strict).toBe(true)
  })

  test('json_object mode puts the schema in the system prompt', async () => {
    const { fetch, seen } = fakeFetch(json({ choices: [{ message: { content: '{}' } }] }))
    const model = openAiCompatibleModel({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://x/v1',
      fetch,
      schemaMode: 'json_object',
    })
    await model.generate(request)
    const messages = at(seen, 0).body.messages as Array<{ content: string }>
    expect(at(messages, 0).content).toContain('JSON Schema')
    expect(at(seen, 0).body.response_format).toEqual({ type: 'json_object' })
  })
})

describe('anthropic adapter', () => {
  test('forces a tool call and reads its input', async () => {
    const { fetch, seen } = fakeFetch(
      json({
        content: [{ type: 'tool_use', input: { answer: 'a', score: null } }],
        usage: { input_tokens: 40, output_tokens: 9 },
      }),
    )
    const model = anthropicModel({ apiKey: 'ak', model: 'claude-haiku-5-5', fetch })
    const result = await model.generate(request)
    expect(result.json).toEqual({ answer: 'a', score: null })
    expect(result.usage).toMatchObject({ promptTokens: 40, outputTokens: 9 })
    const sent = at(seen, 0)
    expect(sent.headers['x-api-key']).toBe('ak')
    expect(sent.headers['anthropic-version']).toBe('2023-06-01')
    expect(sent.body.tool_choice).toEqual({ type: 'tool', name: 'answer' })
    expect(sent.body.system).toBe('system')
  })
})

describe('replay', () => {
  test('records what a live model answers, then replays it offline', async () => {
    const store = new Map()
    const live = recording(scripted('m', { answer: 'recorded', score: 1 }), store)
    await live.generate(request)
    expect(store.size).toBe(1)
    const offline = replayModel('test', 'm', storeFromJson(storeToJson(store)))
    expect((await offline.generate(request)).json).toEqual({ answer: 'recorded', score: 1 })
  })

  test('an unrecorded request is an error, never a made-up answer', async () => {
    const offline = replayModel('test', 'm', new Map())
    expect((await offline.generate(request).catch((e) => e)).kind).toBe('bad-request')
  })

  test('the key depends on model, prompt and schema', () => {
    const a = requestKey('m', request)
    expect(requestKey('m2', request)).not.toBe(a)
    expect(requestKey('m', { ...request, user: 'other' })).not.toBe(a)
    expect(requestKey('m', request)).toBe(a)
  })
})

describe('Gemini schema dialect', () => {
  test('upper-case types, nullable instead of anyOf, no additionalProperties, ordering kept', () => {
    const out = toGeminiSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        b: { type: 'string', enum: ['x', 'y'] },
        a: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        list: { type: 'array', items: { type: 'integer' } },
      },
      required: ['b', 'a', 'list'],
    })
    expect(out).toEqual({
      type: 'OBJECT',
      properties: {
        b: { type: 'STRING', enum: ['x', 'y'] },
        a: { type: 'STRING', nullable: true },
        list: { type: 'ARRAY', items: { type: 'INTEGER' } },
      },
      required: ['b', 'a', 'list'],
      propertyOrdering: ['b', 'a', 'list'],
    })
  })
})

describe('HTTP replay', () => {
  const body = { candidates: [{ content: { parts: [{ text: '{"answer":"x","score":null}' }] } }] }

  test('records a real exchange without the key, then replays it through the same adapter', async () => {
    const store = new Map()
    const { fetch } = fakeFetch(json(body))
    const live = geminiModel({ apiKey: 'secret', model: 'm', fetch: recordingFetch(fetch, store) })
    await live.generate(request)
    expect(JSON.stringify([...store])).not.toContain('secret')

    const offline = geminiModel({
      apiKey: 'another-key',
      model: 'm',
      fetch: replayFetch(httpStoreFromJson(httpStoreToJson(store))),
    })
    expect((await offline.generate(request)).json).toEqual({ answer: 'x', score: null })
  })

  test('an unrecorded request is an unmistakable error, not an answer', async () => {
    const model = geminiModel({ apiKey: 'k', model: 'm', fetch: replayFetch(new Map()) })
    const error = await model.generate(request).catch((e) => e)
    expect(error).toBeInstanceOf(AiError)
  })
})

describe('output cap and thinking setting', () => {
  const capped = {
    system: 's',
    user: 'u',
    schema: Type.Object({ ok: Type.Boolean() }),
    maxOutputTokens: 1234,
  }

  test('Gemini, OpenAI-compatible and Anthropic send the cap', async () => {
    const bodies: Record<string, unknown>[] = []
    const capture = async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          choices: [{ message: { content: '{"ok":true}' } }],
          content: [{ type: 'tool_use', input: { ok: true } }],
        }),
      )
    }
    await geminiModel({ apiKey: 'k', model: 'm', fetch: capture }).generate(capped)
    await openAiCompatibleModel({
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://x.example/v1',
      fetch: capture,
    }).generate(capped)
    await anthropicModel({ apiKey: 'k', model: 'm', fetch: capture }).generate(capped)
    expect((bodies[0]?.generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBe(1234)
    expect(bodies[1]?.max_tokens).toBe(1234)
    expect(bodies[2]?.max_tokens).toBe(1234)
  })

  test('a 400 that is not about thinking does not switch the thinking budget off for good', async () => {
    const sent: unknown[] = []
    const model = geminiModel({
      apiKey: 'k',
      model: 'm',
      thinkingBudget: 0,
      fetch: async (_: unknown, init?: RequestInit) => {
        sent.push(
          (JSON.parse(String(init?.body)).generationConfig as Record<string, unknown>)
            .thinkingConfig,
        )
        return new Response(JSON.stringify({ error: { message: 'Invalid JSON schema' } }), {
          status: 400,
        })
      },
    })
    await expect(model.generate(capped)).rejects.toThrow('400')
    await expect(model.generate(capped)).rejects.toThrow('400')
    // One attempt per call, thinking setting kept both times.
    expect(sent).toEqual([{ thinkingBudget: 0 }, { thinkingBudget: 0 }])
  })

  test('a 400 about thinking retries without it, and remembers', async () => {
    const sent: unknown[] = []
    const model = geminiModel({
      apiKey: 'k',
      model: 'm',
      thinkingBudget: 0,
      fetch: async (_: unknown, init?: RequestInit) => {
        const cfg = JSON.parse(String(init?.body)).generationConfig as Record<string, unknown>
        sent.push(cfg.thinkingConfig)
        return cfg.thinkingConfig
          ? new Response(
              JSON.stringify({ error: { message: 'This model does not support thinking' } }),
              { status: 400 },
            )
          : new Response(
              JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
            )
      },
    })
    await model.generate(capped)
    await model.generate(capped)
    expect(sent).toEqual([{ thinkingBudget: 0 }, undefined, undefined])
  })
})
