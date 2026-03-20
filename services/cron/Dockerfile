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
RUN bun run --cwd services/cron build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/services/cron/dist ./services/cron/dist
COPY --from=source /app/packages/log-transport ./packages/log-transport
COPY --from=source /app/services/cron/entrypoint.sh ./services/cron/entrypoint.sh
RUN chmod +x ./services/cron/entrypoint.sh

ENV ENV=production

ENTRYPOINT ["./services/cron/entrypoint.sh"]
