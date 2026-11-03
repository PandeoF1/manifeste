# MCP server for staff (bulk moderation)

`apps/mcp` is a small [MCP](https://modelcontextprotocol.io) server (stdio) that lets Claude read the
moderation queue of a running instance and approve or reject reports in bulk. It calls the same
API as the admin page (`/api/staff/reports/*`), so every decision goes through the usual checks and
is written to the audit log under the account it signs in with.

## Account

Create a **moderator** account for it (never an admin: the MCP only needs `report:moderate`, and an
admin would need a TOTP code):

```sh
bun run --filter @manifeste/server staff invite claude@example.org "Claude MCP" moderator
```

Open the one-time link to choose a password.

## Configuration

Add it to `.mcp.json` (or `claude mcp add`), on the machine that runs Claude Code:

```json
{
  "mcpServers": {
    "manifeste": {
      "command": "bun",
      "args": ["run", "--cwd", "apps/mcp", "start"],
      "env": {
        "MANIFESTE_URL": "https://manifeste.example.org",
        "MANIFESTE_EMAIL": "claude@example.org",
        "MANIFESTE_PASSWORD": "…"
      }
    }
  }
}
```

Keep the password out of git (use `.mcp.json` in your user scope, not the repository).

## Tools

- `pending_reports`: the queue (newest first, 200 at most from the server), narrowed by `origin`,
  `tier`, `status`, `city` and `minProbability` (the AI judge's probability; unjudged reports never
  pass a floor). Each row carries its source link so it can be checked.
- `decide_reports`: `approve` or `reject` up to 100 ids. **Without `confirm: true` it only says what
  it would do.** An approved report is public at once.

Approving a report whose photo is needed is not covered: photos are blurred and published from the
admin page.

## Safety

- One account, one role, every action audited (`report.approve`, `report.reject`).
- The dry run is the default and a call is capped at 100 reports.
- A report already decided by someone else is reported as failed (HTTP 409), never overwritten.
