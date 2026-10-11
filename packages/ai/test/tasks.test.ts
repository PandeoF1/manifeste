import { describe, expect, test } from 'bun:test'
import {
  analyseMedia,
  buildExtractRequest,
  buildJevQuestions,
  createChain,
  EXTRACT_PROMPTS,
  extractEvents,
  focusState,
  jevJudge,
  llmJudge,
  parseChoices,
  parseExtraction,
  parseJevResponse,
  parseMediaAnalyses,
  reanalyse,
  createMeter,
} from '../src/index.ts'
import { fakeFetch, json, noSleep, scripted } from './helpers.ts'

const day = new Date('2026-10-08T07:00:00Z')
const items = [
  { id: 'a', publishedAt: day, text: 'Le lycée Pasteur de Lille est bloqué ce matin.' },
  { id: 'b', publishedAt: day, text: 'Rien à voir.' },
]
const wire = (over: Record<string, unknown> = {}) => ({
  item_id: 'a',
  school_name: 'Lycée Pasteur',
  city: 'Lille',
  status: 'bloque',
  observed_at: '2026-10-08',
  certainty: 'haute',
  ...over,
})

describe('extraction prompts', () => {
  test('versions differ only by their rules', () => {
    const { v1, 'v1-strict': strict, 'v1-nature': nature } = EXTRACT_PROMPTS
    expect(strict.system.length).toBeGreaterThan(v1.system.length)
    expect(strict.system).toContain('incident (agression')
    expect(v1.system).not.toContain('incident (agression')
    expect(nature.system).toContain('- nature :')
    expect(nature.withNature).toBe(true)
    // The strict rule goes right after the call-to-block rule.
    expect(strict.system.indexOf('appel ou un projet')).toBeLessThan(
      strict.system.indexOf('incident (agression'),
    )
  })

  test('request: ISO publication date, text cut to textChars, schema follows the prompt', () => {
    const request = buildExtractRequest(items, { prompt: 'v1-nature', textChars: 10 })
    expect(request.user).toContain('"publie_le":"2026-10-08T07:00:00.000Z"')
    expect(request.user).toContain('"texte":"Le lycée P"')
    const props = (
      request.schema as unknown as { properties: { events: { items: { properties: object } } } }
    ).properties.events.items.properties
    expect(Object.keys(props)).toContain('nature')
    expect(JSON.stringify(buildExtractRequest(items).schema)).not.toContain('nature')
  })
})

describe('extraction parsing', () => {
  const known = new Set(['a'])

  test('maps the French wire values to the English domain', () => {
    const [event] = parseExtraction(
      { events: [wire({ status: 'filtrant', certainty: 'moyenne' })] },
      known,
    )
    expect(event).toEqual({
      itemId: 'a',
      schoolName: 'Lycée Pasteur',
      city: 'Lille',
      status: 'filtering',
      observedAt: '2026-10-08',
      certainty: 'medium',
    })
  })

  test('drops malformed events, unknown items and garbage, keeps the good ones', () => {
    const events = parseExtraction(
      {
        events: [
          wire({ status: 'ferme' }), // unknown status
          wire({ school_name: 'ab' }), // too short
          wire({ item_id: 'zzz' }), // not in the batch
          'nonsense',
          wire({ school_name: 'Lycée Curie' }),
        ],
      },
      known,
    )
    expect(events.map((e) => e.schoolName)).toEqual(['Lycée Curie'])
    expect(parseExtraction(null, known)).toEqual([])
    expect(parseExtraction({ events: 'x' }, known)).toEqual([])
  })

  test('repairs mojibake the model copied from a badly decoded page', () => {
    const [event] = parseExtraction(
      { events: [wire({ school_name: 'LycÃ©e Ã‰mile-Zola', city: 'LunÃ©ville' })] },
      known,
    )
    expect(event?.schoolName).toBe('Lycée Émile-Zola')
    expect(event?.city).toBe('Lunéville')
  })

  test('nature is mapped when present', () => {
    const [event] = parseExtraction({ events: [wire({ nature: 'rassemblement' })] }, known)
    expect(event?.nature).toBe('gathering')
  })

  test('extractEvents: empty batch makes no call; otherwise one call and parsed events', async () => {
    const model = scripted('m', { events: [wire()] })
    const chain = createChain({
      task: 'extract',
      promptVersion: 'v1',
      models: [model],
      sleep: noSleep,
    })
    expect(await extractEvents(chain, [])).toEqual([])
    expect(model.calls).toBe(0)
    expect((await extractEvents(chain, items)).map((e) => e.itemId)).toEqual(['a'])
    expect(model.calls).toBe(1)
  })
})

describe('judge', () => {
  const school = { name: 'Lycée Pasteur', city: 'Lille' }
  const longText = `Le lycée Pasteur de Lille a été bloqué ce matin par des élèves. ${'Autre phrase sans rapport. '.repeat(20)}`

  test('Jev questions follow the status', () => {
    const blocked = buildJevQuestions(school, 'blocked')
    const lifted = buildJevQuestions(school, 'lifted')
    expect(blocked.bloque?.instructions).toContain('est bloqué par des élèves')
    expect(lifted.bloque?.instructions).toContain('est terminé')
    expect(Object.keys(blocked.nature?.criteria ?? {})).toEqual([
      'blocage',
      'ferme',
      'rassemblement',
      'incident',
      'autre',
    ])
  })

  test('parses the answer and maps it to English values', () => {
    const verdict = parseJevResponse({
      answers: {
        bloque: { noul: 0.91 },
        nature: { choice: 'blocage', probabilities: { blocage: 0.8, autre: 0.2 } },
        level: { choice: 'superieur', probabilities: { superieur: 0.9 } },
      },
    })
    expect(verdict).toEqual({
      probability: 0.91,
      nature: 'blockade',
      natureProbabilities: { blockade: 0.8, other: 0.2 },
      level: 'higher',
      levelProbabilities: { higher: 0.9 },
    })
    expect(parseJevResponse({ answers: {} })).toBeNull()
    expect(parseJevResponse({ answers: { bloque: { noul: 3 } } })).toBeNull()
    expect(parseJevResponse(null)?.probability).toBeUndefined()
  })

  test('focus: title plus the sentences about the school', () => {
    const state = focusState({ title: 'Titre', text: longText }, school, '2026-10-08')
    expect(state.startsWith('Article publié le 2026-10-08\nTitre : Titre')).toBe(true)
    expect(state).toContain('lycée Pasteur de Lille')
    expect(state).not.toContain('Autre phrase sans rapport')
  })

  test('Jev judge: pinned model, bearer key, usage and cost recorded', async () => {
    const { fetch, seen } = fakeFetch(
      json({
        answers: {
          bloque: { noul: 0.8 },
          nature: { choice: 'blocage' },
          level: { choice: 'lycee' },
        },
      }),
    )
    const meter = createMeter()
    const judge = jevJudge({
      apiKey: 'jk',
      fetch,
      sink: meter,
      prices: { 'jev-1.13.0': { inputPerMTok: 42, outputPerMTok: 0 } },
    })
    const verdict = await judge.judge({
      school,
      status: 'blocked',
      text: longText,
      publishedDay: '2026-10-08',
    })
    expect(verdict).toMatchObject({
      probability: 0.8,
      nature: 'blockade',
      level: 'secondary',
      provider: 'jev',
      model: 'jev-1.13.0',
    })
    expect(seen[0]?.headers.authorization).toBe('Bearer jk')
    expect(seen[0]?.body.model).toBe('jev-1.13.0')
    const [row] = meter.drain()
    expect(row).toMatchObject({ task: 'judge', provider: 'jev', calls: 1, failures: 0 })
    expect(row?.costUsd ?? 0).toBeGreaterThan(0)
  })

  test('Jev judge: short text asks nothing; an HTTP error or a thrown fetch gives null', async () => {
    const { fetch, seen } = fakeFetch(json({}, 500), new Error('down'))
    const judge = jevJudge({ apiKey: 'jk', fetch })
    expect(
      await judge.judge({ school, status: 'blocked', text: 'court', publishedDay: '2026-10-08' }),
    ).toBeNull()
    expect(seen).toHaveLength(0)
    const input = { school, status: 'blocked' as const, text: longText, publishedDay: '2026-10-08' }
    expect(await judge.judge(input)).toBeNull()
    expect(await judge.judge(input)).toBeNull()
  })

  test('LLM judge answers the same questions through a model chain', async () => {
    const model = scripted('m', { probability: 0.7, nature: 'ferme', level: 'lycee' })
    const chain = createChain({
      task: 'judge',
      promptVersion: 'v1',
      models: [model],
      sleep: noSleep,
    })
    const judge = llmJudge(chain, { provider: 'test', model: 'm' })
    const verdict = await judge.judge({
      school,
      status: 'blocked',
      text: longText,
      publishedDay: '2026-10-08',
    })
    expect(verdict).toMatchObject({ probability: 0.7, nature: 'closed', level: 'secondary' })
    const bad = createChain({
      task: 'judge',
      promptVersion: 'v1',
      models: [scripted('m', { probability: 7 })],
      sleep: noSleep,
    })
    expect(
      await llmJudge(bad, { provider: 't', model: 'm' }).judge({
        school,
        status: 'blocked',
        text: longText,
        publishedDay: '2026-10-08',
      }),
    ).toBeNull()
  })
})

describe('reanalysis', () => {
  const batch = [
    {
      id: 'r1',
      schoolName: 'Lycée Pasteur',
      city: null,
      status: 'blocked',
      context: 'Titre',
      candidates: [
        { uai: '0590001A', name: 'Lycée Pasteur', city: 'Lille', department: '59' },
        { uai: '0620002B', name: 'Lycée Pasteur', city: 'Arras', department: '62' },
      ],
    },
  ]

  test('keeps confident choices that are really among the candidates', () => {
    const pick = (uai: string | null, certainty: string) =>
      parseChoices({ choices: [{ id: 'r1', uai, certainty }] }, batch)
    expect(pick('0590001A', 'haute').get('r1')).toBe('0590001A')
    expect(pick('0590001A', 'moyenne').get('r1')).toBe('0590001A')
    expect(pick('0590001A', 'faible').size).toBe(0)
    expect(pick('9999999Z', 'haute').size).toBe(0) // invented code
    expect(pick(null, 'haute').size).toBe(0)
  })

  test('reanalyse calls the model once for a non-empty batch', async () => {
    const model = scripted('m', { choices: [{ id: 'r1', uai: '0620002B', certainty: 'haute' }] })
    const chain = createChain({
      task: 'reanalyse',
      promptVersion: 'v1',
      models: [model],
      sleep: noSleep,
    })
    expect((await reanalyse(chain, batch)).get('r1')).toBe('0620002B')
    expect((await reanalyse(chain, [])).size).toBe(0)
    expect(model.calls).toBe(1)
  })
})

describe('media analysis', () => {
  const text = 'Les lycéens réclament plus de moyens. « Nous voulons des profs », dit une élève.'
  const answer = (over: Record<string, unknown> = {}) => ({
    item_id: 'x',
    about_movement: true,
    mentions_demands: true,
    demands: ['plus de moyens'],
    voices: ['lyceens', 'inconnu'],
    focus: 'revendications',
    incidents: false,
    police_violence: false,
    terms: ['lycéens', 'zzz'],
    tone: 'neutre',
    quote_demands: 'Nous voulons des profs',
    quote_framing: 'Une phrase inventée',
    ...over,
  })

  test('maps values, drops unknown words, and removes quotes that are not in the text', () => {
    const [a] = parseMediaAnalyses({ articles: [answer()] }, [{ id: 'x', text }])
    expect(a).toMatchObject({
      itemId: 'x',
      focus: 'demands',
      tone: 'neutral',
      voices: ['students'],
      terms: ['lycéens'],
      quoteDemands: 'Nous voulons des profs',
      quoteFraming: null,
    })
  })

  test('an analysis with an unknown focus is dropped; unknown items too', () => {
    expect(
      parseMediaAnalyses({ articles: [answer({ focus: 'autre' }), answer({ item_id: 'nope' })] }, [
        { id: 'x', text },
      ]),
    ).toEqual([])
  })

  test('analyseMedia: one call', async () => {
    const model = scripted('m', { articles: [answer()] })
    const chain = createChain({
      task: 'media',
      promptVersion: 'v1',
      models: [model],
      sleep: noSleep,
    })
    expect(await analyseMedia(chain, [{ id: 'x', text }])).toHaveLength(1)
    expect(await analyseMedia(chain, [])).toEqual([])
  })
})
