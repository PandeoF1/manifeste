import { describe, expect, test } from 'bun:test'
import { escapeLike } from '../src/lib/sql.ts'

describe('escapeLike', () => {
  test('wildcards and the escape character become literal', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('c:\\dir')).toBe('c:\\\\dir')
    expect(escapeLike('Lycée Pasteur')).toBe('Lycée Pasteur')
  })
})
