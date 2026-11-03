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

The repository's `.mcp.json` declares the server, so it starts by itself in Claude Code (local or
cloud). It reads three variables, and never a password from a file:

| Variable             | Value                                               |
| -------------------- | --------------------------------------------------- |
| `MANIFESTE_URL`      | optional, defaults to `https://manifeste.pandeo.fr` |
| `MANIFESTE_EMAIL`    | the moderator account                               |
| `MANIFESTE_PASSWORD` | its password                                        |

- **Cloud sessions**: add the variables in the environment's settings (the cloud environment menu
  in the session title bar, then Edit). Start a **new session**: MCP servers are read at start.
  The environment's network policy must allow the instance's host.
- **Local**: export the same variables before starting Claude Code.

Never paste the password in a chat or commit it. A claude.ai "custom connector" does not fit: it
needs a hosted OAuth server, which this does not have.

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

## Without the MCP: export, decide in a spreadsheet, import

In the admin page, the "Pending" tab has an "Export / import en masse" block:

1. **Export** the queue (`GET /api/staff/reports/export`): a CSV with an empty `decision` column.
2. Fill `decision` with `approve` or `reject` (or "valider" / "rejeter"; French Excel's `;` is fine), or
   hand the file to Claude. A blank decision leaves the report pending.
3. **Import** the same file: a preview says what would happen, then one click applies it
   (`POST /api/staff/reports/decisions`, 1000 per request, each decision audited as usual).

Left out on purpose: approving a report that has a photo (it must be blurred by hand: reject is
allowed), a report decided in the meantime, an unknown or duplicated id. The export is the moderator
view, with no position and no internal source.
