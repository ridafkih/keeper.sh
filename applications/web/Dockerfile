FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd applications/web build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/applications/web/dist ./applications/web/dist
COPY --from=build /app/applications/web/public ./applications/web/public

WORKDIR /app/applications/web

ENV ENV=production
EXPOSE 3000

CMD ["bun", "dist/server-entry/index.js"]
