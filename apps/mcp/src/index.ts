/**
 * MCP server (stdio) to review the moderation queue in bulk. Configure it with:
 *   MANIFESTE_URL, MANIFESTE_EMAIL, MANIFESTE_PASSWORD  (a moderator account)
 * See docs/mcp.md.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { decideAll, filterPending, MAX_BATCH, StaffClient } from './client.ts'

const need = (name: string) => {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is not set`)
    process.exit(2)
  }
  return value
}

const client = new StaffClient({
  baseUrl: need('MANIFESTE_URL'),
  email: need('MANIFESTE_EMAIL'),
  password: need('MANIFESTE_PASSWORD'),
})

const server = new McpServer({ name: 'manifeste', version: '0.2.0' })
const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})
const failure = (e: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
})

server.registerTool(
  'pending_reports',
  {
    description:
      'List reports waiting for moderation (newest first), with their source and the AI judge probability. Filters are optional.',
    inputSchema: {
      origin: z.string().optional().describe('collected, on_site, …'),
      tier: z.string().optional(),
      status: z.string().optional().describe('blocked, filtering, lifted'),
      minProbability: z.number().min(0).max(1).optional().describe('AI judge probability floor'),
      city: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional().describe('default 50'),
    },
  },
  async (filter) => {
    try {
      const all = await client.pending()
      const rows = filterPending(all, filter)
      return text({
        totalPending: all.length,
        returned: rows.length,
        reports: rows.map((r) => ({
          id: r.id,
          school: `${r.schoolName ?? r.schoolUai} (${r.schoolCity ?? '?'})`,
          status: r.status,
          origin: r.origin,
          tier: r.tier,
          observedAt: r.observedAt,
          source: r.sourceUrl ?? r.sourceDomain,
          judgeProbability: r.judge?.probability ?? null,
        })),
      })
    } catch (e) {
      return failure(e)
    }
  },
)

server.registerTool(
  'decide_reports',
  {
    description: `Approve or reject pending reports by id (at most ${MAX_BATCH} per call). Nothing changes unless confirm is true: without it the call only says what it would do. An approved report becomes public immediately.`,
    inputSchema: {
      ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH),
      decision: z.enum(['approve', 'reject']),
      confirm: z.boolean().default(false),
    },
  },
  async ({ ids, decision, confirm }) => {
    try {
      if (!confirm) return text({ dryRun: true, wouldDecide: ids.length, decision })
      const outcomes = await decideAll(client, ids, decision)
      return text({
        decided: outcomes.filter((o) => o.ok).length,
        failed: outcomes.filter((o) => !o.ok),
      })
    } catch (e) {
      return failure(e)
    }
  },
)

await server.connect(new StdioServerTransport())
