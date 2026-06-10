FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS source
COPY . .

FROM base AS prune
RUN bun install --global turbo
COPY --from=source /app .
RUN turbo prune @keeper.sh/worker --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd services/worker build

FROM base AS runtime
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production
COPY --from=build /app/services/worker/dist ./services/worker/dist
COPY --from=prune /app/out/full/packages/otelemetry ./packages/otelemetry
RUN bun link --cwd packages/otelemetry
COPY --from=source /app/services/worker/entrypoint.sh ./services/worker/entrypoint.sh
RUN chmod +x ./services/worker/entrypoint.sh

ENV ENV=production

ENTRYPOINT ["./services/worker/entrypoint.sh"]
