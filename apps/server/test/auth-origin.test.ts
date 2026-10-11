import { describe, expect, test } from 'bun:test'
import { requestOrigin } from '../src/auth/auth.ts'

const req = (headers: Record<string, string>) =>
  new Request('http://app:3000/api/auth/x', { headers })

describe('requestOrigin', () => {
  test('the visitor origin comes from the proxy headers, the first host wins', () => {
    expect(requestOrigin(req({ 'x-forwarded-host': 'a.example.fr, b.example.fr' }))).toEqual([
      'http://a.example.fr',
    ])
  })
  test('falls back to the Host header, then the URL', () => {
    expect(requestOrigin(req({ host: 'h.example.fr' }))).toEqual(['http://h.example.fr'])
    expect(requestOrigin(req({}))[0]).toBe('http://app:3000')
  })
})
