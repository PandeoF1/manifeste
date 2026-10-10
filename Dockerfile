# One image for every role (ROLE=api|worker|all), the one-shot migrate step and the staff CLI.
# The server is bundled with `bun build`, so the runtime image ships no node_modules.
#   docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t manifeste .
ARG BUN_VERSION=1.4.2

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /src
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/db/package.json packages/db/
COPY legacy/package.json legacy/
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages/db packages/db
COPY apps/server apps/server
COPY apps/web apps/web
# The SPA still imports a few pure modules from the legacy backend (until phase 2).
COPY legacy/supabase/functions/_shared legacy/supabase/functions/_shared
# Public, build-time values for the SPA (it still reads Supabase until phase 6).
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_TURNSTILE_SITE_KEY=
ARG VITE_MAP_STYLE_URL=
RUN cd apps/web && bunx vite build
RUN cd apps/server && bun run build \
 && cp "$(dirname "$(bun -e "console.log(Bun.resolveSync('@scalar/api-reference', process.cwd()))")")/browser/standalone.js" dist/scalar.js \
 && cp "$(bun -e "console.log(Bun.resolveSync('@resvg/resvg-wasm/index_bg.wasm', process.cwd()))")" dist/resvg.wasm

FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app
COPY --from=build /src/apps/server/dist ./
COPY --from=build /src/packages/db/migrations ./migrations
COPY --from=build /src/apps/web/dist ./web
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/migrations \
    SCALAR_BUNDLE=/app/scalar.js \
    RESVG_WASM=/app/resvg.wasm \
    DATA_DIR=/data
# Photos (private originals and published blurred versions) live on a volume shared by the api
# and the worker, so the retention sweeper sees what the api wrote.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health/live'); process.exit(r.ok ? 0 : 1)"]
# Other commands: `bun migrate.js` (one-shot migrations), `bun staff.js invite <email> <name> <role>`.
CMD ["bun", "index.js"]
