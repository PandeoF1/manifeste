import { describe, expect, it } from 'bun:test'
import {
  applyEvent,
  edgeFor,
  EDGES,
  emptyStats,
  type TraceRow,
} from '../src/components/admin/live/graph'

let id = 0
const row = (o: Partial<TraceRow>): TraceRow => ({
  id: ++id,
  run_id: 'r',
  t: '2026-10-06T10:00:00.000Z',
  actor: 'lecteurs',
  target: 'rss',
  phase: 'req',
  label: '',
  detail: null,
  ms: null,
  n: null,
  status: null,
  ...o,
})

describe('edgeFor', () => {
  it('trouve l’arête de chaque service, y compris depuis le collecteur (une seule source)', () => {
    expect(edgeFor('lecteurs', 'telegram')?.key).toBe('lecteurs>telegram')
    expect(edgeFor('collecteur', 'telegram')?.key).toBe('lecteurs>telegram')
    expect(edgeFor('collecteur', 'gemini')?.key).toBe('collecteur>gemini')
    expect(edgeFor('collecteur', 'inconnu')).toBeNull()
  })
  it('chaque arête a un tracé', () => {
    expect(EDGES.every((e) => e.path.startsWith('M '))).toBe(true)
  })
})

describe('applyEvent', () => {
  it('compte requêtes en vol, erreurs, durées et issues en base', () => {
    const s = emptyStats()
    applyEvent(s, row({ actor: 'collecteur', target: 'collecteur', phase: 'start', n: 100 }), 0)
    applyEvent(s, row({ phase: 'req', label: 'ladepeche.fr/rss.xml' }), 1)
    applyEvent(s, row({ phase: 'req', label: 'lemonde.fr/rss' }), 2)
    applyEvent(s, row({ phase: 'res', ms: 400 }), 3)
    applyEvent(s, row({ phase: 'err', ms: 200, status: 403 }), 4)
    applyEvent(s, row({ actor: 'collecteur', target: 'gemini', phase: 'req' }), 5)
    applyEvent(s, row({ actor: 'collecteur', target: 'base', phase: 'res', detail: 'rattache' }), 6)
    applyEvent(
      s,
      row({ actor: 'collecteur', target: 'base', phase: 'res', detail: 'non_rattache' }),
      7,
    )
    applyEvent(
      s,
      row({
        actor: 'collecteur',
        target: 'collecteur',
        phase: 'end',
        label: '1 signal',
        detail: 'x',
      }),
      8,
    )
    expect(s.sources).toBe(100)
    expect(s.requests).toBe(3)
    expect(s.errors).toBe(1)
    expect(s.geminiCalls).toBe(1)
    expect([s.linked, s.unmatched]).toEqual([1, 1])
    expect(s.edges.get('lecteurs>rss')).toEqual({
      req: 2,
      done: 2,
      err: 1,
      totalMs: 600,
      last: 'lemonde.fr/rss',
    })
    expect(s.summary).toBe('1 signal · x')
  })
})
