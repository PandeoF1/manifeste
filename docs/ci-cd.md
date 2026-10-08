# CI/CD

| Event                     | What runs                                               | Database                                              |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Pull request (any branch) | CI: type-check, lint, unit tests, build, SQL tests      | none: migrations are replayed on a throwaway Postgres |
| Push to `develop`         | CI, then deploy to the **development** Supabase project | `db push` + Edge Functions                            |
| Push to `main`            | CI, then deploy to the **production** Supabase project  | `db push` + Edge Functions                            |

The front end is deployed by Vercel's Git integration (not by these workflows): `main` is production,
`develop` is a preview deployment.

## One-time setup

1. **GitHub > Settings > Environments**: create `development` and `production`.
   For `production`, add "Required reviewers" if you want a manual approval before each deploy.
2. In each environment:
   - Variable `SUPABASE_PROJECT_REF`: the project ref (the part before `.supabase.co`).
   - Secret `SUPABASE_ACCESS_TOKEN`: a personal access token from
     <https://supabase.com/dashboard/account/tokens> (can be the same for both).
   - Secret `SUPABASE_DB_PASSWORD`: that project's database password.
3. **Vercel > Settings > Environment Variables**: set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` for _Production_ (prod project) and for _Preview_ (dev project), so
   `develop` talks to the dev database. Optionally attach a domain to the `develop` branch.
4. Edge Function secrets (Gemini key, collect secret, Turnstile) are set per project with
   `supabase secrets set`; the workflows never touch them. Leave the dev project without a Gemini
   key if you do not want the collector to run there.

Until `SUPABASE_PROJECT_REF` exists in an environment, the deploy steps are skipped (the job still runs, empty).

## Working on a feature

```
git checkout -b my-feature develop     # branch from develop
# ... code, and a migration in supabase/migrations/ if the schema changes
git push -u origin my-feature          # open a pull request into develop
```

- The pull request runs CI only. It never touches a database.
- Merge into `develop`: the development project is migrated and its functions redeployed.
- When `develop` looks good, open a pull request `develop` -> `main`: merging it migrates and deploys production.

## Migration rules

- Never edit a migration that already ran: add a new file.
- Do not apply migrations by hand on a project the pipeline deploys, or the history drifts. If it
  does, repair it with `supabase migration repair --status applied <version>`.
- The database changes before the front end and the functions, so keep migrations backward
  compatible with the code still running: add columns and tables first, remove them in a later
  release once nothing uses them.
