import { describe, expect, it } from 'bun:test'
import { parseUnmatched } from '@/lib/unmatchedCsv'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const D = '44444444-4444-4444-8444-444444444444'
const head = 'id,uai,school_cited,c1_uai,c1_name,c2_uai,c2_name'

describe('parseUnmatched', () => {
  it('reads a UAI, a candidate rank, a dismissal, and leaves blanks waiting', () => {
    const csv = `\uFEFF${head}\r\n${A},0591234A,Pasteur,0590001A,X,0590002B,Y\r\n${B},2,Brizeux,0290001A,Z,0290002B,W\r\n${C},ecarter,?,,,,\r\n${D},,?,,,,\r\n`
    const r = parseUnmatched(csv)
    expect(r.decisions).toEqual([
      { id: A, uai: '0591234A' },
      { id: B, uai: '0290002B' },
      { id: C, dismiss: true },
    ])
    expect(r.blank).toBe(1)
    expect(r.unreadable).toEqual([])
  })

  it('accepts ";", lowercase UAIs and "c1"', () => {
    const r = parseUnmatched(`id;uai;c1_uai\n${A};0591234a;0590001A\n${B};C1;0590001A`)
    expect(r.decisions).toEqual([
      { id: A, uai: '0591234A' },
      { id: B, uai: '0590001A' },
    ])
  })

  it('flags a rank with no candidate, a bad UAI and a bad id, with line numbers', () => {
    const r = parseUnmatched(
      `${head}\n${A},3,x,0590001A,X,0590002B,Y\n${B},12345,x,,,,\nnope,0591234A,x,,,,`,
    )
    expect(r.unreadable).toEqual([2, 3, 4])
    expect(r.decisions).toEqual([])
  })

  it('refuses a file without the id and uai columns', () => {
    expect(parseUnmatched('a,b\n1,2').error).toContain('uai')
  })
})
