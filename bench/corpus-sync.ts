/**
 * Copies the parser corpus between a local folder and the private bucket.
 *
 *   bun corpus-sync.ts push [dir]   upload what the bucket does not have yet
 *   bun corpus-sync.ts pull [dir]   download what the folder does not have yet
 *
 * The folder defaults to ~/manifest-corpus (CORPUS_DIR overrides). The bucket is read from
 * R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CORPUS_BUCKET (default manifeste-corpus).
 */
import { S3Client } from 'bun'
import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [command, dirArg] = process.argv.slice(2)
const dir = dirArg ?? process.env.CORPUS_DIR ?? join(homedir(), 'manifest-corpus')

const need = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const bucket = new S3Client({
  endpoint: need('R2_ENDPOINT'),
  accessKeyId: need('R2_ACCESS_KEY_ID'),
  secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
  bucket: process.env.CORPUS_BUCKET ?? 'manifeste-corpus',
})

async function listRemote(): Promise<Set<string>> {
  const keys = new Set<string>()
  let token: string | undefined
  do {
    const page = await bucket.list({ maxKeys: 1000, continuationToken: token })
    for (const item of page.contents ?? []) keys.add(item.key)
    token = page.isTruncated ? page.nextContinuationToken : undefined
  } while (token)
  return keys
}

async function listLocal(): Promise<Set<string>> {
  const keys = new Set<string>()
  for (const file of await readdir(join(dir, 'cache')).catch(() => [])) keys.add(`cache/${file}`)
  if (await Bun.file(join(dir, 'urls.json')).exists()) keys.add('urls.json')
  return keys
}

const remote = await listRemote()
const local = await listLocal()

if (command === 'push') {
  // urls.json changes whenever pages are added, so it always goes up; pages are immutable.
  const todo = [...local].filter((k) => k === 'urls.json' || !remote.has(k))
  for (const key of todo) await bucket.write(key, Bun.file(join(dir, key)))
  console.log(`pushed ${todo.length} files (${remote.size} already there)`)
} else if (command === 'pull') {
  await mkdir(join(dir, 'cache'), { recursive: true })
  const todo = [...remote].filter((k) => k === 'urls.json' || !local.has(k))
  for (const key of todo) await Bun.write(join(dir, key), await bucket.file(key).arrayBuffer())
  console.log(`pulled ${todo.length} files into ${dir}`)
} else {
  console.error('usage: bun corpus-sync.ts push|pull [dir]')
  process.exit(1)
}
