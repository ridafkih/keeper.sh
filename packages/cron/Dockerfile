FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/cron --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd packages/cron build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/packages/cron/dist ./packages/cron/dist
COPY --from=source /app/packages/cron/entrypoint.sh ./packages/cron/entrypoint.sh
RUN chmod +x ./packages/cron/entrypoint.sh

ENV NODE_ENV=production

ENTRYPOINT ["./packages/cron/entrypoint.sh"]
