# Contributing

Thanks for your interest. Issues and pull requests are welcome, in French or in English. Code, comments, tests, documentation and commit messages are in English; only the site's user-facing text is in French.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on the approach.

The project follows a few rules that every change must respect:

- **No tracking and no personal data.** No accounts for visitors, no third-party analytics or
  scripts, no storage of IP addresses or exact positions.
- **Informative tone.** The site reports sourced facts. It does not call for action and does not
  take sides on demands.
- **Every point has a public source.** Do not add private channels or scrape behind logins.

## Development

```bash
bun install
cp .env.example .env
bun run dev
```

Run these before opening a pull request (see [docs/development.md](docs/development.md) for the local Postgres):

```bash
bun run check      # type-check, lint, unit and integration tests
bun run build
```

Code style is enforced by Prettier and ESLint (`bun run format`). TypeScript is strict.

## Database changes

Change the Drizzle schema in `packages/db/src/schema/` and generate a migration
(`bun run --filter @manifeste/db generate`). Never edit a migration that is already applied, and
cover new rules with a test. Business rules live in `packages/core` as pure, tested functions; SQL
is for set-based queries. Access control is done in the API (`apps/server`): every new route needs
a permission check unless it is public by design.

## Pull requests

Keep them focused, describe the user-visible change and mention any migration. Commit messages in
English, in the imperative ("Add moderator role"). CI must pass.
