import { describe, expect, it } from 'bun:test'
import { parseDecisions } from '@/lib/decisionsCsv'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('parseDecisions', () => {
  it('reads the exported file once the decision column is filled', () => {
    const csv = `\uFEFFid,decision,school,city\r\n${A},approve,"Lycée ""X"", annexe",Lille\r\n${B},reject,Y,Paris\r\n${C},,Z,Nice\r\n`
    const r = parseDecisions(csv)
    expect(r.decisions).toEqual([
      { id: A, decision: 'approve' },
      { id: B, decision: 'reject' },
    ])
    expect(r.blank).toBe(1)
    expect(r.unreadable).toEqual([])
    expect(r.error).toBeNull()
  })

  it('accepts the ";" of French spreadsheets and French words, accents or not', () => {
    const r = parseDecisions(`id;Décision\n${A};Valider\n${B};rejeté\n${C};Oui`)
    expect(r.decisions.map((d) => d.decision)).toEqual(['approve', 'reject', 'approve'])
  })

  it('reports words and ids it cannot read, with their line numbers', () => {
    const r = parseDecisions(`id,decision\n${A},peut-être\nnot-an-id,approve\n${B},reject`)
    expect(r.unreadable).toEqual([2, 3])
    expect(r.decisions).toEqual([{ id: B, decision: 'reject' }])
  })

  it('refuses a file without the id and decision columns', () => {
    expect(parseDecisions('a,b\n1,2').error).toContain('id')
  })
})
