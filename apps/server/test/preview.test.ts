import { afterAll, describe, expect, test } from 'bun:test'
import pg from 'pg'
import { testServerUrl } from '@manifeste/db/testing'
import { previewDatabaseName, resolvePreviewEnv } from '../src/preview.ts'
import { loadConfig } from '../src/config.ts'

const created: string[] = []
afterAll(async () => {
  const client = new pg.Client({ connectionString: testServerUrl() })
  await client.connect()
  for (const name of created) await client.query(`drop database if exists ${name} with (force)`)
  await client.end()
})

describe('previews', () => {
  test('database names are safe identifiers', () => {
    expect(previewDatabaseName('feat/New-Parser')).toBe('preview_feat_new_parser')
    expect(previewDatabaseName('pull/42/head')).toBe('preview_pull_42_head')
    expect(previewDatabaseName('///')).toBe('preview_default')
  })

  test('outside previews the environment is unchanged', async () => {
    const env = { DATABASE_URL: 'postgres://x@y/z' }
    expect(await resolvePreviewEnv(env)).toBe(env)
  })

  test('creates one database per preview and points DATABASE_URL at it', async () => {
    const id = `t${Date.now()}`
    created.push(previewDatabaseName(id))
    const env = await resolvePreviewEnv(
      { PREVIEW_DATABASE_SERVER_URL: testServerUrl(), PREVIEW_ID: id },
      () => {},
    )
    expect(new URL(env.DATABASE_URL ?? '').pathname).toBe(`/${previewDatabaseName(id)}`)
    expect(env.MIGRATE_ON_BOOT).toBe('true')
    // Booting again reuses the database.
    const again = await resolvePreviewEnv(
      { PREVIEW_DATABASE_SERVER_URL: testServerUrl(), PREVIEW_ID: id },
      () => {},
    )
    expect(again.DATABASE_URL).toBe(env.DATABASE_URL)
  })

  test('PUBLIC_URL falls back to the first Coolify URL', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgres://u@h/d',
      AUTH_SECRET: 'x'.repeat(32),
      COOLIFY_URL: 'https://pr-12.preview.example.org/,https://other.example.org',
    })
    expect(c.PUBLIC_URL).toBe('https://pr-12.preview.example.org')
  })
})
