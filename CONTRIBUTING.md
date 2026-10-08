# Contributing

Thanks for your interest. Issues and pull requests are welcome, in French or in English.

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
npm install
cp .env.example .env.local
npm run dev
```

Run these before opening a pull request:

```bash
npm run check      # type-check, lint, unit tests
npm run test:db    # SQL tests (needs a local Postgres 16 with PostGIS, pg_trgm, unaccent)
npm run build
```

Code style is enforced by Prettier and ESLint (`npm run format`). TypeScript is strict.

## Database changes

Add a new file in `supabase/migrations/` (never edit one that is already applied) and cover it with
a test in `supabase/tests/`. Row level security is the real access control: every new table needs
policies, and functions that use `security definer` must check the caller's role.

## Pull requests

Keep them focused, describe the user-visible change and mention any migration. Commit messages in
English, in the imperative ("Add moderator role"). CI must pass.
