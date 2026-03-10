FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune canary-web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd applications/canary-web build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/applications/canary-web/dist ./applications/canary-web/dist

WORKDIR /app/applications/canary-web

ENV ENV=production
EXPOSE 3000

CMD ["bun", "dist/server-entry/index.js"]
