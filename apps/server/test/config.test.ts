import { describe, expect, test } from 'bun:test'
import { ConfigError, loadConfig } from '../src/config.ts'

const base = {
  DATABASE_URL: 'postgres://u@localhost/db',
  AUTH_SECRET: 'x'.repeat(32),
}

describe('loadConfig', () => {
  test('applies defaults', () => {
    const c = loadConfig(base)
    expect(c.ROLE).toBe('all')
    expect(c.PORT).toBe(3000)
    expect(c.MIGRATE_ON_BOOT).toBe(false)
    expect(c.PUBLIC_URL).toBe('http://localhost:3000')
  })

  test('converts numbers and booleans', () => {
    const c = loadConfig({ ...base, PORT: '8080', MIGRATE_ON_BOOT: 'true', ROLE: 'worker' })
    expect(c.PORT).toBe(8080)
    expect(c.MIGRATE_ON_BOOT).toBe(true)
    expect(c.ROLE).toBe('worker')
  })

  test('treats empty strings as unset', () => {
    expect(loadConfig({ ...base, PORT: '' }).PORT).toBe(3000)
  })

  test('lists every problem at once', () => {
    try {
      loadConfig({ AUTH_SECRET: 'short', ROLE: 'nope' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const message = (error as Error).message
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('AUTH_SECRET')
      expect(message).toContain('ROLE')
    }
  })

  test('rejects a public URL with a trailing slash', () => {
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'https://example.org/' })).toThrow(ConfigError)
  })
})
