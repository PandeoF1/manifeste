/**
 * Runs the ingestion pipeline from a terminal, for a one-off or a recovery.
 *
 *   bun src/cli/ingest.ts tick                         read every due source, then run the stages
 *   bun src/cli/ingest.ts backfill --since-hours 168 [--source <id>] [--run]
 *   bun src/cli/ingest.ts reextract --since-hours 48 [--source <id>] [--run]
 *   bun src/cli/ingest.ts rejudge --since-hours 168 [--limit 200] [--run]
 *   bun src/cli/ingest.ts rematch [--limit 200] [--ai] [--run]
 *
 * An operation is a dry run (it prints what it would do and costs nothing) unless --run is given.
 * Uses the same configuration and stages as the worker, without the queue.
 */
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.ts'
import { createContext } from '../context.ts'
import { IngestOperations, OPERATION_KINDS, type Operation } from '../ingest/operations.ts'
import { IngestService } from '../ingest/service.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: 'boolean', default: false },
    'since-hours': { type: 'string' },
    source: { type: 'string' },
    limit: { type: 'string' },
    ai: { type: 'boolean', default: false },
  },
})
const [command] = positionals
const isOperation = (c: string | undefined): c is (typeof OPERATION_KINDS)[number] =>
  (OPERATION_KINDS as readonly string[]).includes(c ?? '')
if (command !== 'tick' && !isOperation(command)) {
  console.error(
    `usage: bun src/cli/ingest.ts <tick|${OPERATION_KINDS.join('|')}> [options] (see the file header)`,
  )
  process.exit(1)
}

const ctx = createContext(loadConfig())
// No queue here: the stages run one after the other in this process.
const ingest = new IngestService(ctx, { trigger: async () => {} })
try {
  if (command === 'tick') {
    for (const id of await ingest.dueSources())
      console.log(id, await ingest.discover(id, 'schedule'))
    await ingest.drain(50)
    console.log('done')
  } else {
    const hours = Number(values['since-hours'] ?? 48)
    const limit = values.limit ? Number(values.limit) : undefined
    const source = values.source
    const op: Operation =
      command === 'rematch'
        ? { kind: 'rematch', ...(limit && { limit }), ...(values.ai && { useAi: true }) }
        : command === 'rejudge'
          ? { kind: 'rejudge', sinceHours: hours, ...(limit && { limit }) }
          : { kind: command, sinceHours: hours, ...(source && { sourceId: source }) }
    const result = await new IngestOperations(ingest).run(op, { dryRun: !values.run })
    console.log(JSON.stringify(result, null, 2))
    if (result.dryRun) console.log('\nThis was a dry run. Add --run to do it.')
  }
} finally {
  await ctx.close()
}
