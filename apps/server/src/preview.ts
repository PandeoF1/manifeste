/**
 * PR previews: every preview gets its own database on a shared preview Postgres, cloned from
 * `preview_template` (a migrated, sanitized dataset). The preview then applies its own
 * migrations at boot, so a PR that changes the schema never touches staging or production.
 *
 * Enabled by PREVIEW_DATABASE_SERVER_URL (a URL on the preview server with CREATEDB rights).
 * The database name comes from PREVIEW_ID, else COOLIFY_BRANCH. Each boot stamps the database,
 * and databases of previews not booted for PREVIEW_RETENTION_DAYS are dropped.
 */
import pg from 'pg'

export const PREVIEW_TEMPLATE = 'preview_template'
const RETENTION_DAYS = 14

export const previewDatabaseName = (id: string): string =>
  `preview_${
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'default'
  }`

function withDatabase(url: string, name: string): string {
  const u = new URL(url)
  u.pathname = `/${name}`
  return u.toString()
}

/** Returns the environment to boot with: unchanged outside previews. */
export async function resolvePreviewEnv(
  env: Record<string, string | undefined>,
  log: (message: string) => void = console.log,
): Promise<Record<string, string | undefined>> {
  const server = env.PREVIEW_DATABASE_SERVER_URL
  if (!server) return env
  const id = env.PREVIEW_ID || env.COOLIFY_BRANCH
  if (!id)
    throw new Error(
      'PREVIEW_DATABASE_SERVER_URL is set but neither PREVIEW_ID nor COOLIFY_BRANCH is',
    )
  const name = previewDatabaseName(id)

  const client = new pg.Client({ connectionString: withDatabase(server, 'postgres') })
  await client.connect()
  try {
    const exists = async (db: string) =>
      (await client.query('select 1 from pg_database where datname = $1', [db])).rowCount === 1
    if (!(await exists(name))) {
      const template = (await exists(PREVIEW_TEMPLATE)) ? ` template ${PREVIEW_TEMPLATE}` : ''
      await client.query(`create database ${name}${template}`)
      log(`preview database ${name} created${template ? ` from ${PREVIEW_TEMPLATE}` : ' (empty)'}`)
    }
    await client.query(`comment on database ${name} is 'last_boot=${new Date().toISOString()}'`)
    await dropStalePreviews(client, name, log)
  } finally {
    await client.end()
  }
  return { ...env, DATABASE_URL: withDatabase(server, name), MIGRATE_ON_BOOT: 'true' }
}

async function dropStalePreviews(client: pg.Client, current: string, log: (m: string) => void) {
  const { rows } = await client.query<{ datname: string; comment: string | null }>(
    `select datname, shobj_description(oid, 'pg_database') as comment
       from pg_database where datname like 'preview\\_%' and datname <> $1 and datname <> $2`,
    [current, PREVIEW_TEMPLATE],
  )
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
  for (const row of rows) {
    const lastBoot = Date.parse(row.comment?.replace('last_boot=', '') ?? '')
    if (Number.isFinite(lastBoot) && lastBoot > cutoff) continue
    await client.query(`drop database if exists ${row.datname} with (force)`)
    log(`stale preview database ${row.datname} dropped`)
  }
}
