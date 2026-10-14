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

  test('a Coolify http:// domain becomes https in production (TLS ends at Cloudflare)', () => {
    const base = { DATABASE_URL: 'postgres://x', AUTH_SECRET: 'a'.repeat(32) }
    const url = (env: Record<string, string>) =>
      loadConfig({ ...base, COOLIFY_URL: 'http://m.example.fr,http://b.example.fr', ...env })
        .PUBLIC_URL
    expect(url({ NODE_ENV: 'production' })).toBe('https://m.example.fr')
    expect(url({ NODE_ENV: 'development' })).toBe('http://m.example.fr')
    expect(url({ NODE_ENV: 'production', PUBLIC_URL: 'http://forced.example.fr' })).toBe(
      'http://forced.example.fr',
    )
  })
})

describe('photo storage', () => {
  test('the volume is the default', () => {
    const c = loadConfig(base)
    expect(c.BLOB_STORE).toBe('fs')
    expect(c.S3_REGION).toBe('auto')
  })

  test('s3 needs a bucket and a key pair, and says which are missing', () => {
    expect(() => loadConfig({ ...base, BLOB_STORE: 's3' })).toThrow(
      'S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
    )
    expect(() =>
      loadConfig({ ...base, BLOB_STORE: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k' }),
    ).toThrow('S3_SECRET_ACCESS_KEY')
    const ok = loadConfig({
      ...base,
      BLOB_STORE: 's3',
      S3_BUCKET: 'photos',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      S3_ENDPOINT: 'https://abc.r2.cloudflarestorage.com',
    })
    expect(ok.S3_BUCKET).toBe('photos')
  })

  test('the endpoint must be a URL', () => {
    expect(() =>
      loadConfig({
        ...base,
        BLOB_STORE: 's3',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_ENDPOINT: 'minio:9000',
      }),
    ).toThrow(ConfigError)
  })
})
